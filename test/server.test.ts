import { describe, expect, it } from "vitest";
import { startServer } from "../src/daemon/server.ts";
import { TaskService } from "../src/gateway/taskService.ts";
import { createLogger } from "../src/observability/logger.ts";
import { ModelRegistry } from "../src/registry/modelRegistry.ts";
import { Router } from "../src/router/router.ts";
import { Scheduler } from "../src/scheduler/scheduler.ts";
import { SessionRepo } from "../src/store/sessionRepo.ts";
import { TaskRepo } from "../src/store/taskRepo.ts";
import { tempDb } from "./helpers.ts";

const AUTH = { authorization: "Bearer test-token" };

async function withServer(fn: (base: string, sessions: SessionRepo, tasks: TaskRepo) => Promise<void>): Promise<void> {
  const { db, dir, cleanup } = tempDb();
  const tasks = new TaskRepo(db);
  const sessions = new SessionRepo(db);
  const registry = new ModelRegistry(db);
  const taskService = new TaskService(tasks, new Router(), registry, new Scheduler(1, async () => {}), sessions);
  const logger = createLogger({ stateDir: dir });
  const { server, port } = await startServer(
    { registry, taskService, logger, stateDir: dir, sessionContextChars: 12_000, onShutdown: () => {} },
    { host: "127.0.0.1", port: 0, token: "test-token" },
  );
  try {
    await fn(`http://127.0.0.1:${port}`, sessions, tasks);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanup();
  }
}

describe("POST /v1/sessions/:id/clear", () => {
  it("清空累积上下文并保留会话与任务历史", async () => {
    await withServer(async (base, sessions, tasks) => {
      sessions.ensure("s1", "标题");
      sessions.appendTurn("s1", "第一问", "第一答");
      tasks.create({ type: "other", prompt: "第一问", sessionKey: "s1" });

      const res = await fetch(`${base}/v1/sessions/s1/clear`, { method: "POST", headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; clearedChars: number };
      expect(body.ok).toBe(true);
      expect(body.clearedChars).toBeGreaterThan(0);
      expect(sessions.getContext("s1")).toBe("");
      expect(sessions.tasksOf("s1")).toHaveLength(1);

      const detail = await fetch(`${base}/v1/sessions/s1`, { headers: AUTH });
      const detailBody = (await detail.json()) as { session: { context?: string } };
      expect(detailBody.session.context).toBe("");
    });
  });

  it("会话不存在返回 404", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/v1/sessions/nope/clear`, { method: "POST", headers: AUTH });
      expect(res.status).toBe(404);
    });
  });

  it("缺少 token 返回 401", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/v1/sessions/s1/clear`, { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  it("重复清空幂等", async () => {
    await withServer(async (base, sessions) => {
      sessions.ensure("s1", "标题");
      const first = await fetch(`${base}/v1/sessions/s1/clear`, { method: "POST", headers: AUTH });
      const second = await fetch(`${base}/v1/sessions/s1/clear`, { method: "POST", headers: AUTH });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const body = (await second.json()) as { clearedChars: number };
      expect(body.clearedChars).toBe(0);
    });
  });
});
