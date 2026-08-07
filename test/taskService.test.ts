import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "../src/gateway/taskService.ts";
import { ModelRegistry } from "../src/registry/modelRegistry.ts";
import { Router } from "../src/router/router.ts";
import { Scheduler } from "../src/scheduler/scheduler.ts";
import { SessionRepo } from "../src/store/sessionRepo.ts";
import { TaskRepo } from "../src/store/taskRepo.ts";
import { tempDb } from "./helpers.ts";

describe("TaskService", () => {
  it("routes asynchronously via free-model analysis (analyzing → queued + routingInfo)", async () => {
    const { db, cleanup } = tempDb();
    try {
      const repo = new TaskRepo(db);
      const registry = new ModelRegistry(db);
      registry.create({
        name: "free",
        provider: "opencode",
        modelId: "free-model",
        channel: "runtime",
        wireApi: "openai-compatible",
        billing: { type: "free" },
        capabilities: { contextWindow: 128_000, streaming: true },
      });
      const paid = registry.create({
        name: "paid",
        provider: "deepseek",
        modelId: "paid-model",
        channel: "direct",
        wireApi: "anthropic",
        baseUrl: "https://api.example.com/anthropic",
        billing: { type: "pay-as-you-go", unitPrices: { input: 0.5, output: 1.5 }, currency: "USD" },
        capabilities: { contextWindow: 128_000, toolCalling: true, reasoning: true },
      });
      const router = new Router();
      const scheduler = new Scheduler(2, async () => {});
      const service = new TaskService(repo, router, registry, scheduler, new SessionRepo(db), async () => ({
        type: "fix",
        complexity: "high",
        capabilities: ["tool_calling"],
        recommendation: paid.modelId,
        reason: "需要工具调用",
      }));

      const task = service.submit("修复这个 bug");
      expect(task.status).toBe("analyzing");
      await new Promise((r) => setTimeout(r, 50));
      const routed = repo.get(task.id);
      expect(routed?.status).toBe("queued");
      expect(routed?.modelId).toBe(paid.id);
      expect(routed?.type).toBe("fix");
      expect(routed?.routingInfo).toContain('"source":"free-model"');
    } finally {
      cleanup();
    }
  });

  it("submits directly to queue when modelId is forced", () => {
    const { db, cleanup } = tempDb();
    try {
      const repo = new TaskRepo(db);
      const registry = new ModelRegistry(db);
      const model = registry.create({
        name: "m",
        provider: "p",
        modelId: "m1",
        channel: "direct",
        wireApi: "anthropic",
        baseUrl: "https://x",
        billing: { type: "pay-as-you-go", unitPrices: { input: 1, output: 1 }, currency: "USD" },
        capabilities: { contextWindow: 4096 },
      });
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}), new SessionRepo(db));
      const task = service.submit("测试", { modelId: model.id });
      expect(task.status).toBe("queued");
      expect(task.modelId).toBe(model.id);
    } finally {
      cleanup();
    }
  });

  it("builds session chain via parentId", () => {
    const { db, cleanup } = tempDb();
    try {
      const repo = new TaskRepo(db);
      const registry = new ModelRegistry(db);
      const model = registry.create({
        name: "m",
        provider: "p",
        modelId: "m1",
        channel: "direct",
        wireApi: "anthropic",
        baseUrl: "https://x",
        billing: { type: "free" },
        capabilities: { contextWindow: 4096 },
      });
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}), new SessionRepo(db));
      const t1 = service.submit("第一轮", { modelId: model.id });
      const t2 = service.submit("第二轮", { parentId: t1.id, modelId: model.id });
      const chain = service.chain(t2.id);
      expect(chain.map((t) => t.id)).toEqual([t1.id, t2.id]);
      expect(t1.sessionKey).toBeTruthy();
      expect(t2.sessionKey).toBe(t1.sessionKey);
    } finally {
      cleanup();
    }
  });

  it("stores the submit working directory as task targetDir", () => {
    const { db, cleanup } = tempDb();
    const dir = mkdtempSync(join(tmpdir(), "ao-cwd-"));
    try {
      const repo = new TaskRepo(db);
      const registry = new ModelRegistry(db);
      const model = registry.create({
        name: "m",
        provider: "p",
        modelId: "m1",
        channel: "direct",
        wireApi: "anthropic",
        baseUrl: "https://x",
        billing: { type: "free" },
        capabilities: { contextWindow: 4096 },
      });
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}), new SessionRepo(db));
      const task = service.submit("任务", { modelId: model.id, cwd: dir });
      expect(task.targetDir).toBe(dir);
      expect(repo.get(task.id)?.targetDir).toBe(dir);
      expect(() => service.submit("x", { modelId: model.id, cwd: "/nonexistent-ao-xyz" })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      cleanup();
    }
  });

  it("auto-creates a session on first task and appends subsequent tasks to it", () => {
    const { db, cleanup } = tempDb();
    try {
      const repo = new TaskRepo(db);
      const registry = new ModelRegistry(db);
      const model = registry.create({
        name: "m",
        provider: "p",
        modelId: "m1",
        channel: "direct",
        wireApi: "anthropic",
        baseUrl: "https://x",
        billing: { type: "free" },
        capabilities: { contextWindow: 4096 },
      });
      const sessions = new SessionRepo(db);
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}), sessions);
      const t1 = service.submit("第一轮", { modelId: model.id });
      expect(t1.sessionKey).toBeTruthy();
      const session = service.getSession(t1.sessionKey as string);
      expect(session.title).toBe("第一轮");
      const t2 = service.submit("第二轮", { modelId: model.id, sessionId: t1.sessionKey as string });
      expect(t2.sessionKey).toBe(t1.sessionKey);
      const tasks = service.sessionTasks(t1.sessionKey as string);
      expect(tasks.map((t) => t.id)).toEqual([t1.id, t2.id]);
      expect(service.listSessions()).toHaveLength(1);
      expect(() => service.getSession("missing")).toThrow();
    } finally {
      cleanup();
    }
  });
});
