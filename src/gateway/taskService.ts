import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeWithFreeModel, type TaskAnalysis } from "../router/analyzer.ts";
import { ModelRegistry } from "../registry/modelRegistry.ts";
import { Router } from "../router/router.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { SessionRepo } from "../store/sessionRepo.ts";
import { TaskRepo } from "../store/taskRepo.ts";
import type { ModelRecord, Session, Task, TaskType } from "../types.ts";

export type Analyzer = (prompt: string, freeModel: ModelRecord) => Promise<TaskAnalysis | null>;

export class TaskError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const TASK_TYPES: TaskType[] = ["refactor", "fix", "test", "review", "other"];

export class TaskService {
  private readonly repo: TaskRepo;
  private readonly router: Router;
  private readonly registry: ModelRegistry;
  private readonly scheduler: Scheduler;
  private readonly sessions: SessionRepo;
  private readonly analyzer: Analyzer;

  constructor(
    repo: TaskRepo,
    router: Router,
    registry: ModelRegistry,
    scheduler: Scheduler,
    sessions: SessionRepo,
    analyzer: Analyzer = analyzeWithFreeModel,
  ) {
    this.repo = repo;
    this.router = router;
    this.registry = registry;
    this.scheduler = scheduler;
    this.sessions = sessions;
    this.analyzer = analyzer;
  }

  submit(prompt: string, opts: { modelId?: string; parentId?: string; sessionId?: string; cwd?: string } = {}): Task {
    const trimmed = prompt.trim();
    if (!trimmed) throw new TaskError("prompt is required", "INVALID_PROMPT");

    let targetDir: string | null = null;
    if (opts.cwd) {
      targetDir = resolve(opts.cwd);
      if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
        throw new TaskError(`working directory not found: ${targetDir}`, "INVALID_CWD");
      }
    }

    let sessionKey: string | null = null;
    if (opts.parentId) {
      const parent = this.repo.get(opts.parentId);
      if (!parent) throw new TaskError("parent task not found", "PARENT_NOT_FOUND");
      sessionKey = parent.sessionKey ?? parent.id;
    } else if (opts.sessionId) {
      sessionKey = opts.sessionId;
    } else {
      // 首次输入：自动创建新会话/项目
      sessionKey = randomUUID();
    }
    this.sessions.ensure(sessionKey, trimmed);

    let modelRecord: ModelRecord | null = null;
    if (opts.modelId) {
      const model = this.registry.get(opts.modelId);
      if (model.status !== "active") throw new TaskError(`model ${opts.modelId} is not active`, "MODEL_INACTIVE");
      modelRecord = model;
    }

    const task = this.repo.create({
      type: this.router.classify(trimmed),
      prompt: trimmed,
      modelId: modelRecord?.id ?? null,
      parentId: opts.parentId ?? null,
      sessionKey,
      targetDir,
      routingInfo: modelRecord
        ? JSON.stringify({ source: "explicit", model: `${modelRecord.provider}/${modelRecord.modelId}`, analysis: null })
        : null,
    });

    if (modelRecord) {
      const queued = this.repo.updateStatus(task.id, "queued") ?? task;
      this.scheduler.enqueue(queued);
      return queued;
    }

    // 默认路由：免费模型分析 → 能力/成本选择（异步，不阻塞提交）
    this.repo.updateStatus(task.id, "analyzing");
    void this.runAnalysis(task.id);
    return this.repo.get(task.id) ?? task;
  }

  get(id: string): Task {
    const task = this.repo.get(id);
    if (!task) throw new TaskError("task not found", "TASK_NOT_FOUND");
    return task;
  }

  list(): Task[] {
    return this.repo.list();
  }

  /** 会话链：从根任务到当前任务（旧 → 新） */
  chain(id: string): Task[] {
    const chain: Task[] = [];
    let current: Task | undefined = this.repo.get(id);
    if (!current) throw new TaskError("task not found", "TASK_NOT_FOUND");
    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.repo.get(current.parentId) : undefined;
    }
    return chain;
  }

  getSession(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new TaskError("session not found", "SESSION_NOT_FOUND");
    return session;
  }

  listSessions(): Session[] {
    return this.sessions.list();
  }

  sessionTasks(id: string): Task[] {
    this.getSession(id);
    return this.sessions.tasksOf(id);
  }

  /** 清空会话累积上下文（保留会话与任务历史） */
  clearSessionContext(id: string): { clearedChars: number } {
    this.getSession(id); // 不存在时抛 SESSION_NOT_FOUND
    return { clearedChars: this.sessions.clearContext(id) };
  }

  cancel(id: string): Task {
    const task = this.get(id);
    const cancellable =
      task.status === "created" ||
      task.status === "analyzing" ||
      (task.status === "queued" && this.scheduler.cancelQueued(id));
    if (cancellable) {
      return this.repo.updateStatus(id, "cancelled", { finishedAt: Date.now() }) ?? task;
    }
    throw new TaskError(
      `cannot cancel task in status "${task.status}" (running cancellation lands in Phase 6)`,
      "CANNOT_CANCEL",
    );
  }

  private async runAnalysis(taskId: string): Promise<void> {
    const task = this.repo.get(taskId);
    if (!task || task.status !== "analyzing") return;
    const freeModel = this.registry.list("active").find((m) => m.billing.type === "free");
    const analysis = freeModel ? await this.analyzer(task.prompt, freeModel) : null;
    const current = this.repo.get(taskId);
    if (!current || current.status !== "analyzing") return; // 分析期间被取消
    const selection = this.router.selectModel(task.prompt, this.registry.list("active"), analysis);
    const type: TaskType =
      analysis && TASK_TYPES.includes(analysis.type as TaskType) ? (analysis.type as TaskType) : this.router.classify(task.prompt);
    const routingInfo = JSON.stringify({
      source: selection.source,
      model: `${selection.model.provider}/${selection.model.modelId}`,
      analysis: selection.analysis
        ? {
            type: selection.analysis.type,
            complexity: selection.analysis.complexity,
            capabilities: selection.analysis.capabilities,
            recommendation: selection.analysis.recommendation ?? null,
            reason: selection.analysis.reason,
          }
        : null,
    });
    const queued = this.repo.updateStatus(taskId, "queued", { modelId: selection.model.id, type, routingInfo });
    if (queued) this.scheduler.enqueue(queued);
  }
}
