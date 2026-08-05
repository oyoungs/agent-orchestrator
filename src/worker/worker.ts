import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AdapterFactory } from "../adapters/factory.ts";
import type { AdapterUsage, AgentTaskInput } from "../adapters/types.ts";
import { buildContextPrompt } from "../context/sessionContext.ts";
import type { Logger } from "../observability/logger.ts";
import { ModelRegistry } from "../registry/modelRegistry.ts";
import type { SessionRepo } from "../store/sessionRepo.ts";
import { TaskRepo } from "../store/taskRepo.ts";
import type { AppConfig, ModelRecord, Task, UsageRecord } from "../types.ts";
import { Validator } from "../validator/validator.ts";
import { WorkspaceManager } from "../workspace/workspace.ts";

export class WorkerFailure extends Error {
  readonly errorClass: string;
  constructor(message: string, errorClass: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

export interface WorkerDeps {
  taskRepo: TaskRepo;
  registry: ModelRegistry;
  sessions: SessionRepo;
  workspace: WorkspaceManager;
  adapters: AdapterFactory;
  validator: Validator;
  logger: Logger;
  config: AppConfig;
  stateDir: string;
}

export async function executeTask(deps: WorkerDeps, task: Task): Promise<void> {
  const startedAt = Date.now();
  deps.taskRepo.updateStatus(task.id, "running", { startedAt });
  deps.logger.info("task.running", { taskId: task.id });

  let model: ModelRecord | undefined;
  try {
    model = task.modelId ? deps.registry.get(task.modelId) : undefined;
  } catch {
    model = undefined;
  }
  if (!model) {
    await failTask(deps, task, "model_missing", "model was removed or not found before execution", startedAt);
    return;
  }

  const runId = randomUUID();
  let allocated = false;

  try {
    const ws = deps.workspace.allocate(task.id);
    allocated = true;
    insertRun(deps, runId, task, model, ws, "running");
    const outputDir = join(deps.stateDir, "runs", task.id);
    mkdirSync(outputDir, { recursive: true });
    const outputFile = join(outputDir, "output.jsonl");

    const adapter = deps.adapters.pick(model);
    const sessionContext = task.sessionKey ? deps.sessions.getContext(task.sessionKey) : "";
    const context =
      buildContextPrompt(sessionContext, deps.config.orchestrator.sessionContextChars) ??
      (await buildChainContext(deps, task));
    const input: AgentTaskInput = {
      prompt: task.prompt,
      context,
      cwd: ws,
      model,
      timeoutMs: deps.config.orchestrator.defaultTimeoutSec * 1000,
      env: {},
      budgetUsd: 0.5,
    };
    let lastUsage: AdapterUsage | undefined;
    let lastAgentResult: string | undefined;
    for await (const event of adapter.invoke(input)) {
      appendFileSync(outputFile, JSON.stringify(event) + "\n");
      if (event.type === "usage") {
        lastUsage = event.usage;
        insertUsage(deps, runId, model, event.usage, startedAt);
      } else if (event.type === "finished" && event.result) {
        lastAgentResult = event.result;
      } else if (event.type === "error") {
        throw new WorkerFailure(event.message, event.errorClass);
      }
    }
    if (lastAgentResult && task.sessionKey) {
      deps.sessions.appendTurn(
        task.sessionKey,
        task.prompt,
        lastAgentResult,
        deps.config.orchestrator.sessionContextChars,
      );
      deps.logger.info("session.context_updated", { taskId: task.id, sessionId: task.sessionKey });
    }

    const validation = await deps.validator.run(task.type, ws);
    const summary = JSON.stringify({ agentResult: lastAgentResult ?? null, validation });
    if (validation.ok) {
      deps.taskRepo.updateStatus(task.id, "succeeded", { finishedAt: Date.now(), resultSummary: summary });
      deps.logger.info("task.succeeded", { taskId: task.id, checks: validation.checks.map((c) => c.name).join(",") });
      insertMetric(deps, runId, "task.success", { taskId: task.id });
    } else {
      deps.taskRepo.updateStatus(task.id, "validation_failed", { finishedAt: Date.now(), resultSummary: summary });
      deps.logger.warn("task.validation_failed", { taskId: task.id, checks: validation.checks });
      insertMetric(deps, runId, "task.validation_failure", { taskId: task.id });
    }
    finishRun(deps, runId, 0, null);
  } catch (err) {
    const errorClass = err instanceof WorkerFailure ? err.errorClass : "agent_crash";
    const message = err instanceof Error ? err.message : String(err);
    await failTask(deps, task, errorClass, message, startedAt);
    finishRun(deps, runId, 1, errorClass);
  } finally {
    if (allocated) deps.workspace.release(task.id);
    const status = deps.taskRepo.get(task.id)?.status;
    deps.logger.info("task.finished", { taskId: task.id, status });
  }
}

/** 会话续接：把父任务链（最多 5 轮）的提问与结果作为上下文 */
async function buildChainContext(deps: WorkerDeps, task: Task, maxTurns = 5): Promise<string | undefined> {
  const turns: Array<{ prompt: string; result?: string }> = [];
  let current: Task | undefined = task.parentId ? deps.taskRepo.get(task.parentId) : undefined;
  while (current && turns.length < maxTurns) {
    let result: string | undefined;
    if (current.resultSummary) {
      try {
        const parsed = JSON.parse(current.resultSummary) as { agentResult?: string };
        if (parsed.agentResult) result = parsed.agentResult;
      } catch {
        // 忽略无法解析的历史结果
      }
    }
    turns.push({ prompt: current.prompt, result });
    current = current.parentId ? deps.taskRepo.get(current.parentId) : undefined;
  }
  if (turns.length === 0) return undefined;
  return turns
    .reverse()
    .map((t) => `用户: ${t.prompt}${t.result ? `\n结果: ${t.result}` : ""}`)
    .join("\n\n");
}

async function failTask(
  deps: WorkerDeps,
  task: Task,
  errorClass: string,
  message: string,
  startedAt: number,
): Promise<void> {
  deps.taskRepo.updateStatus(task.id, "failed", {
    finishedAt: Date.now(),
    resultSummary: JSON.stringify({ errorClass, error: message.slice(0, 2000) }),
  });
  insertMetric(deps, null, "task.failure", { taskId: task.id, errorClass });
  deps.logger.error("task.failed", { taskId: task.id, errorClass, message: message.slice(0, 500), durationMs: Date.now() - startedAt });
}

function insertRun(
  deps: WorkerDeps,
  runId: string,
  task: Task,
  model: ModelRecord,
  workspacePath: string,
  status: string,
): void {
  const db = deps.taskRepo.db;
  db.prepare(
    `INSERT INTO worker_runs
       (id, task_id, agent_id, model_id, workspace_path, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, task.id, null, model.id, workspacePath, status, Date.now());
}

function finishRun(deps: WorkerDeps, runId: string, exitCode: number, errorClass: string | null): void {
  const db = deps.taskRepo.db;
  db.prepare(
    "UPDATE worker_runs SET status = ?, exit_code = ?, error_class = ?, finished_at = ? WHERE id = ?",
  ).run(errorClass ? "failed" : "finished", exitCode, errorClass, Date.now(), runId);
}

function insertUsage(deps: WorkerDeps, runId: string, model: ModelRecord, usage: AdapterUsage, startedAt: number): void {
  const db = deps.taskRepo.db;
  const record: UsageRecord = {
    id: randomUUID(),
    runId,
    provider: model.provider,
    model: model.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    latencyMs: Date.now() - startedAt,
    costUsd: costOfUsage(model, usage),
    source: "provider",
  };
  db.prepare(
    `INSERT INTO usage_records
       (id, run_id, provider, model, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, latency_ms, cost_usd, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.runId,
    record.provider,
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
    record.reasoningTokens,
    record.latencyMs,
    record.costUsd,
    record.source,
  );
}

/** 成本核算：provider usage × 价格表（ADR-0014，不信任 Agent 上报 cost） */
export function costOfUsage(model: ModelRecord, usage: AdapterUsage): number {
  const prices = model.billing.unitPrices;
  if (!prices) return 0;
  const input = (usage.inputTokens / 1_000_000) * prices.input;
  const output = (usage.outputTokens / 1_000_000) * prices.output;
  const cacheRead = prices.cacheRead ? (usage.cacheReadTokens ?? 0) / 1_000_000 * prices.cacheRead : 0;
  return Number((input + output + cacheRead).toFixed(6));
}

function insertMetric(deps: WorkerDeps, runId: string | null, eventType: string, payload: Record<string, unknown>): void {
  const db = deps.taskRepo.db;
  db.prepare("INSERT INTO metric_events (run_id, event_type, ts, payload) VALUES (?, ?, ?, ?)").run(
    runId,
    eventType,
    Date.now(),
    JSON.stringify(payload),
  );
}
