import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ZodError, z } from "zod";
import type { ModelRecord, ModelStatus } from "../types.ts";
import { modelCreateSchema, modelUpdateSchema } from "./modelSchema.ts";

export class ModelError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class ModelNotFoundError extends ModelError {
  constructor(id: string) {
    super(`model not found: ${id}`, "MODEL_NOT_FOUND");
  }
}

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  channel: string;
  wire_api: string;
  base_url: string;
  auth_ref: string | null;
  billing: string;
  capabilities: string;
  status: string;
  created_at: number;
  updated_at: number;
  added_by: string | null;
}

function rowToModel(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    modelId: row.model_id,
    channel: row.channel as ModelRecord["channel"],
    wireApi: row.wire_api as ModelRecord["wireApi"],
    baseUrl: row.base_url,
    authRef: row.auth_ref ?? undefined,
    billing: JSON.parse(row.billing),
    capabilities: JSON.parse(row.capabilities),
    status: row.status as ModelStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    addedBy: row.added_by ?? undefined,
  };
}

export class ModelRegistry {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: unknown, actor?: string): ModelRecord {
    const data = modelCreateSchema.parse(input);
    const id = randomUUID();
    const now = Date.now();
    const rec: ModelRecord = {
      id,
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      channel: data.channel,
      wireApi: data.wireApi,
      baseUrl: data.baseUrl ?? "",
      authRef: data.authRef,
      billing: data.billing,
      capabilities: data.capabilities,
      status: data.status ?? "active",
      createdAt: now,
      updatedAt: now,
      addedBy: data.addedBy ?? actor,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO models
             (id, name, provider, model_id, channel, wire_api, base_url, auth_ref,
              billing, capabilities, status, created_at, updated_at, added_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rec.id,
          rec.name,
          rec.provider,
          rec.modelId,
          rec.channel,
          rec.wireApi,
          rec.baseUrl,
          rec.authRef ?? null,
          JSON.stringify(rec.billing),
          JSON.stringify(rec.capabilities),
          rec.status,
          rec.createdAt,
          rec.updatedAt,
          rec.addedBy ?? null,
        );
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        throw new ModelError(`model already exists: ${rec.provider}/${rec.modelId}`, "MODEL_EXISTS");
      }
      throw err;
    }
    this.audit(id, "add", rec, actor);
    return rec;
  }

  get(id: string): ModelRecord {
    const row = this.db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
    if (!row) throw new ModelNotFoundError(id);
    return rowToModel(row);
  }

  list(status?: ModelStatus): ModelRecord[] {
    const rows = status
      ? (this.db.prepare("SELECT * FROM models WHERE status = ? ORDER BY created_at ASC").all(status) as unknown as ModelRow[])
      : (this.db.prepare("SELECT * FROM models ORDER BY created_at ASC").all() as unknown as ModelRow[]);
    return rows.map(rowToModel);
  }

  update(id: string, patch: unknown, actor?: string): ModelRecord {
    const data = modelUpdateSchema.parse(patch);
    const existing = this.get(id);
    const next: ModelRecord = {
      ...existing,
      ...data,
      billing: data.billing ?? existing.billing,
      capabilities: data.capabilities ?? existing.capabilities,
      status: data.status ?? existing.status,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE models SET name = ?, base_url = ?, auth_ref = ?, billing = ?, capabilities = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.baseUrl,
        next.authRef ?? null,
        JSON.stringify(next.billing),
        JSON.stringify(next.capabilities),
        next.status,
        next.updatedAt,
        id,
      );
    this.audit(id, "update", patch, actor);
    return next;
  }

  setStatus(id: string, status: ModelStatus, actor?: string): ModelRecord {
    return this.update(id, { status }, actor);
  }

  remove(id: string, actor?: string): void {
    const existing = this.get(id);
    this.db.prepare("DELETE FROM models WHERE id = ?").run(id);
    this.audit(id, "remove", { provider: existing.provider, modelId: existing.modelId }, actor);
  }

  private audit(modelId: string, action: string, payload: unknown, actor?: string): void {
    this.db
      .prepare("INSERT INTO model_change_log (model_id, action, payload, actor, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(modelId, action, JSON.stringify(payload), actor ?? null, Date.now());
  }
}

export { ZodError };
