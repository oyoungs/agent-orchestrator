import type { DatabaseSync } from "node:sqlite";
import type { Session, Task } from "../types.ts";

interface SessionRow {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  task_count?: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: row.task_count,
  };
}

export class SessionRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** 创建会话（已存在则忽略）并刷新 updated_at */
  ensure(id: string, title: string): void {
    const now = Date.now();
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, title.slice(0, 200), now, now);
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  list(): Session[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, COUNT(t.id) AS task_count
         FROM sessions s LEFT JOIN tasks t ON t.session_key = s.id
         GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 50`,
      )
      .all() as unknown as SessionRow[];
    return rows.map(rowToSession);
  }

  /** 会话任务队列（按创建时间升序） */
  tasksOf(sessionId: string): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE session_key = ? ORDER BY created_at ASC")
      .all(sessionId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.taskFromRow(row));
  }

  private taskFromRow(row: Record<string, unknown>): Task {
    return {
      id: String(row.id),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      sessionKey: row.session_key === null ? null : String(row.session_key),
      dagGroup: row.dag_group === null ? null : String(row.dag_group),
      type: String(row.type) as Task["type"],
      prompt: String(row.prompt),
      status: String(row.status) as Task["status"],
      agentId: row.agent_id === null ? null : String(row.agent_id),
      modelId: row.model_id === null ? null : String(row.model_id),
      workspaceId: row.workspace_id === null ? null : String(row.workspace_id),
      priority: Number(row.priority),
      retryCount: Number(row.retry_count),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      startedAt: row.started_at === null ? null : Number(row.started_at),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at),
      resultSummary: row.result_summary === null ? null : String(row.result_summary),
      routingInfo: row.routing_info === null ? null : String(row.routing_info),
    };
  }
}
