import type { Task } from "../types.ts";

export type TaskRunner = (task: Task) => Promise<void>;

export class Scheduler {
  private readonly queue: Task[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly runner: TaskRunner;

  constructor(concurrency: number, runner: TaskRunner) {
    this.concurrency = concurrency;
    this.runner = runner;
  }

  enqueue(task: Task): void {
    this.queue.push(task);
    void this.drain();
  }

  /** 仅能取消仍在队列中的任务 */
  cancelQueued(taskId: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }

  private async drain(): Promise<void> {
    while (this.active < this.concurrency) {
      const task = this.queue.shift();
      if (!task) break;
      this.active += 1;
      void this.runOne(task);
    }
  }

  private async runOne(task: Task): Promise<void> {
    try {
      await this.runner(task);
    } catch (err) {
      // runner 负责状态落库；此处兜底防止调度循环中断
      console.error(`scheduler: unhandled runner error for task ${task.id}`, err);
    } finally {
      this.active -= 1;
      void this.drain();
    }
  }
}
