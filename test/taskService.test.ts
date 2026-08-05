import { describe, expect, it } from "vitest";
import { TaskService } from "../src/gateway/taskService.ts";
import { ModelRegistry } from "../src/registry/modelRegistry.ts";
import { Router } from "../src/router/router.ts";
import { Scheduler } from "../src/scheduler/scheduler.ts";
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
      const service = new TaskService(repo, router, registry, scheduler, async () => ({
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
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}));
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
      const service = new TaskService(repo, new Router(), registry, new Scheduler(2, async () => {}));
      const t1 = service.submit("第一轮", { modelId: model.id });
      const t2 = service.submit("第二轮", { parentId: t1.id, modelId: model.id });
      const chain = service.chain(t2.id);
      expect(chain.map((t) => t.id)).toEqual([t1.id, t2.id]);
      expect(t2.sessionKey).toBe(t1.id);
    } finally {
      cleanup();
    }
  });
});
