import { ModelRegistry } from "../registry/modelRegistry.ts";
import { Router, NoModelsError } from "../router/router.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { TaskRepo } from "../store/taskRepo.ts";
import type { Task } from "../types.ts";

export class TaskError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class TaskService {
  private readonly repo: TaskRepo;
  private readonly router: Router;
  private readonly registry: ModelRegistry;
  private readonly scheduler: Scheduler;

  constructor(repo: TaskRepo, router: Router, registry: ModelRegistry, scheduler: Scheduler) {
    this.repo = repo;
    this.router = router;
    this.registry = registry;
    this.scheduler = scheduler;
  }

  submit(prompt: string): Task {
    const trimmed = prompt.trim();
    if (!trimmed) throw new TaskError("prompt is required", "INVALID_PROMPT");
    const models = this.registry.list("active");
    const plan = this.router.plan(trimmed, models);
    const model = plan.candidates[0];
    if (!model) throw new NoModelsError();
    const task = this.repo.create({ type: plan.type, prompt: trimmed, modelId: model.id });
    const queued = this.repo.updateStatus(task.id, "queued") ?? task;
    this.scheduler.enqueue(queued);
    return queued;
  }

  get(id: string): Task {
    const task = this.repo.get(id);
    if (!task) throw new TaskError("task not found", "TASK_NOT_FOUND");
    return task;
  }

  list(): Task[] {
    return this.repo.list();
  }

  cancel(id: string): Task {
    const task = this.get(id);
    if (task.status === "created" || (task.status === "queued" && this.scheduler.cancelQueued(id))) {
      return this.repo.updateStatus(id, "cancelled", { finishedAt: Date.now() }) ?? task;
    }
    throw new TaskError(
      `cannot cancel task in status "${task.status}" (running cancellation lands in Phase 6)`,
      "CANNOT_CANCEL",
    );
  }
}
