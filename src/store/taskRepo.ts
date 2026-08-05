import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Task, TaskStatus, TaskType } from "../types.ts";

interface TaskRow {
  id: string;
  parent_id: string | null;
  dag_group: string | null;
  type: string;
  prompt: string;
  status: string;
  agent_id: string | null;
  model_id: string | null;
  workspace_id: string | null;
  priority: number;
  retry_count: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  result_summary: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id,
    dagGroup: row.dag_group,
    type: row.type as TaskType,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    agentId: row.agent_id,
    modelId: row.model_id,
    workspaceId: row.workspace_id,
    priority: row.priority,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    resultSummary: row.result_summary,
  };
}

export class TaskRepo {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: { type: TaskType; prompt: string; modelId?: string }): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      parentId: null,
      dagGroup: null,
      type: input.type,
      prompt: input.prompt,
      status: "created",
      agentId: null,
      modelId: input.modelId ?? null,
      workspaceId: null,
      priority: 0,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      resultSummary: null,
    };
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, parent_id, dag_group, type, prompt, status, agent_id, model_id,
            workspace_id, priority, retry_count, created_at, updated_at, started_at, finished_at, result_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.parentId,
        task.dagGroup,
        task.type,
        task.prompt,
        task.status,
        task.agentId,
        task.modelId,
        task.workspaceId,
        task.priority,
        task.retryCount,
        task.createdAt,
        task.updatedAt,
        task.startedAt,
        task.finishedAt,
        task.resultSummary,
      );
    return task;
  }

  get(id: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  list(): Task[] {
    const rows = this.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100").all() as unknown as TaskRow[];
    return rows.map(rowToTask);
  }

  updateStatus(id: string, status: TaskStatus, extra?: Partial<Task>): Task | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next: Task = { ...current, ...extra, status, updatedAt: Date.now() };
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, agent_id = ?, model_id = ?, workspace_id = ?,
           started_at = ?, finished_at = ?, result_summary = ?, retry_count = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.agentId,
        next.modelId,
        next.workspaceId,
        next.startedAt,
        next.finishedAt,
        next.resultSummary,
        next.retryCount,
        next.updatedAt,
        id,
      );
    return next;
  }

  markInterrupted(): void {
    this.db
      .prepare("UPDATE tasks SET status = 'interrupted', updated_at = ? WHERE status IN ('running', 'queued', 'created')")
      .run(Date.now());
  }
}
