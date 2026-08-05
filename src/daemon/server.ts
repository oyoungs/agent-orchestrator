import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ModelError, ModelNotFoundError, ZodError } from "../registry/modelRegistry.ts";
import { probeModel } from "../connector/probe.ts";
import { TaskError } from "../gateway/taskService.ts";
import type { Logger } from "../observability/logger.ts";
import { ModelRegistry } from "../registry/modelRegistry.ts";
import { NoModelsError, RouterError } from "../router/router.ts";
import { safeEqual } from "../security/token.ts";
import type { TaskService } from "../gateway/taskService.ts";
import { readOutputEvents } from "./output.ts";

export interface ServerContext {
  registry: ModelRegistry;
  taskService: TaskService;
  logger: Logger;
  stateDir: string;
  onShutdown: () => void;
}

export function startServer(
  ctx: ServerContext,
  opts: { host: string; port: number; token: string },
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void handle(ctx, req, res, opts.token).catch((err) => {
      ctx.logger.error("http.unhandled", { error: (err as Error).message });
      sendJson(res, 500, { error: { code: "INTERNAL", message: "internal error" } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({ server, port });
    });
  });
}

async function handle(ctx: ServerContext, req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "v1") {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unknown path" } });
    return;
  }
  if (url.pathname !== "/v1/health" && !authorized(req, token)) {
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "invalid or missing token" } });
    return;
  }

  const [resource, id, sub] = parts.slice(1);
  try {
    if (resource === "health") return sendJson(res, 200, { ok: true });
    if (resource === "shutdown" && req.method === "POST") {
      sendJson(res, 200, { ok: true });
      setTimeout(() => ctx.onShutdown(), 50);
      return;
    }
    if (resource === "models") return await handleModels(ctx, req, res, id, sub);
    if (resource === "tasks") return await handleTasks(ctx, req, res, id, sub, url.searchParams);
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: `unknown resource: ${resource}` } });
  } catch (err) {
    mapError(res, err);
  }
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return safeEqual(provided, token);
}

async function handleModels(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  id?: string,
  sub?: string,
): Promise<void> {
  const registry = ctx.registry;
  if (!id) {
    if (req.method === "POST") {
      const body = await readJson(req);
      const model = registry.create(body ?? {}, "cli");
      ctx.logger.info("model.added", { modelId: model.id, provider: model.provider, modelName: model.modelId });
      return sendJson(res, 201, model);
    }
    if (req.method === "GET") {
      return sendJson(res, 200, registry.list());
    }
    return sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: `unsupported ${req.method}` } });
  }
  if (sub === "probe" && req.method === "POST") {
    const model = registry.get(id);
    const outcome = await probeModel(model, ctx.logger);
    if (!outcome.ok && (outcome.status === 401 || outcome.status === 403)) {
      registry.setStatus(id, "error", "probe");
    }
    return sendJson(res, 200, { ...outcome, statusAfterProbe: registry.get(id).status });
  }
  switch (req.method) {
    case "GET": {
      return sendJson(res, 200, registry.get(id));
    }
    case "PATCH": {
      const patch = await readJson(req);
      const updated = registry.update(id, patch ?? {}, "cli");
      ctx.logger.info("model.updated", { modelId: id });
      return sendJson(res, 200, updated);
    }
    case "DELETE": {
      registry.remove(id, "cli");
      ctx.logger.info("model.removed", { modelId: id });
      return sendJson(res, 200, { ok: true });
    }
    default:
      return sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: `unsupported ${req.method}` } });
  }
}

async function handleTasks(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  id?: string,
  sub?: string,
  search?: URLSearchParams,
): Promise<void> {
  const svc = ctx.taskService;
  if (!id) {
    if (req.method === "POST") {
      const body = await readJson(req);
      const task = svc.submit(String(body?.prompt ?? ""));
      ctx.logger.info("task.submitted", { taskId: task.id, type: task.type });
      return sendJson(res, 201, task);
    }
    if (req.method === "GET") return sendJson(res, 200, svc.list());
    return sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: `unsupported ${req.method}` } });
  }
  if (sub === "cancel" && req.method === "POST") {
    const task = svc.cancel(id);
    ctx.logger.info("task.cancelled", { taskId: id });
    return sendJson(res, 200, task);
  }
  if (sub === "output" && req.method === "GET") {
    const raw = Number(search?.get("after") ?? 0);
    const after = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return sendJson(res, 200, readOutputEvents(ctx.stateDir, id, after));
  }
  if (req.method === "GET") return sendJson(res, 200, svc.get(id));
  return sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: `unsupported ${req.method}` } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1024 * 1024) throw new ModelError("request body too large", "BODY_TOO_LARGE");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

function mapError(res: ServerResponse, err: unknown): void {
  if (err instanceof ZodError) {
    return sendJson(res, 400, {
      error: { code: "VALIDATION_ERROR", message: "invalid request body", details: err.issues },
    });
  }
  if (err instanceof ModelNotFoundError) {
    return sendJson(res, 404, { error: { code: err.code, message: err.message } });
  }
  if (err instanceof TaskError && err.code === "TASK_NOT_FOUND") {
    return sendJson(res, 404, { error: { code: err.code, message: err.message } });
  }
  if (err instanceof NoModelsError) {
    return sendJson(res, 409, { error: { code: err.code, message: err.message } });
  }
  if (err instanceof ModelError || err instanceof TaskError || err instanceof RouterError) {
    return sendJson(res, 400, { error: { code: err.code, message: err.message } });
  }
  if (err instanceof SyntaxError) {
    return sendJson(res, 400, { error: { code: "INVALID_JSON", message: err.message } });
  }
  return sendJson(res, 500, { error: { code: "INTERNAL", message: (err as Error).message } });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}
