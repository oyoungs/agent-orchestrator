import { analyzeWithFreeModel, type TaskAnalysis } from "../router/analyzer.ts";
import { ModelRegistry } from "../registry/modelRegistry.ts";
import { Router } from "../router/router.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { TaskRepo } from "../store/taskRepo.ts";
import type { ModelRecord, Task, TaskType } from "../types.ts";

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
  private readonly analyzer: Analyzer;

  constructor(
    repo: TaskRepo,
    router: Router,
    registry: ModelRegistry,
    scheduler: Scheduler,
    analyzer: Analyzer = analyzeWithFreeModel,
  ) {
    this.repo = repo;
    this.router = router;
    this.registry = registry;
    this.scheduler = scheduler;
    this.analyzer = analyzer;
  }

  submit(prompt: string, opts: { modelId?: string; parentId?: string } = {}): Task {
    const trimmed = prompt.trim();
    if (!trimmed) throw new TaskError("prompt is required", "INVALID_PROMPT");

    let sessionKey: string | null = null;
    if (opts.parentId) {
      const parent = this.repo.get(opts.parentId);
      if (!parent) throw new TaskError("parent task not found", "PARENT_NOT_FOUND");
      sessionKey = parent.sessionKey ?? parent.id;
    }

    let modelId: string | null = null;
    if (opts.modelId) {
      const model = this.registry.get(opts.modelId);
      if (model.status !== "active") throw new TaskError(`model ${opts.modelId} is not active`, "MODEL_INACTIVE");
      modelId = model.id;
    }

    const task = this.repo.create({
      type: this.router.classify(trimmed),
      prompt: trimmed,
      modelId,
      parentId: opts.parentId ?? null,
      sessionKey,
    });

    if (modelId) {
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
