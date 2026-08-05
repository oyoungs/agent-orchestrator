import { describe, expect, it } from "vitest";
import { ModelError, ModelNotFoundError, ModelRegistry, ZodError } from "../src/registry/modelRegistry.ts";
import { tempDb } from "./helpers.ts";

describe("ModelRegistry", () => {
  it("creates, lists, gets, updates, removes with audit trail", () => {
    const { db, cleanup } = tempDb();
    try {
      const registry = new ModelRegistry(db);
      const created = registry.create(
        {
          name: "qwen3-max",
          provider: "qwen",
          modelId: "qwen3-max",
          channel: "direct",
          wireApi: "openai-compatible",
          baseUrl: "https://api.qwen.example/v1",
          authRef: "QWEN_API_KEY",
          billing: { type: "pay-as-you-go", unitPrices: { input: 0.5, output: 1.5 }, currency: "USD" },
          capabilities: { contextWindow: 128_000, toolCalling: true, streaming: true },
        },
        "test",
      );
      expect(created.status).toBe("active");
      expect(created.id).toBeTruthy();

      expect(registry.list()).toHaveLength(1);
      expect(registry.get(created.id).name).toBe("qwen3-max");

      const updated = registry.update(created.id, { status: "disabled" });
      expect(updated.status).toBe("disabled");
      expect(registry.list("active")).toHaveLength(0);

      registry.remove(created.id);
      expect(() => registry.get(created.id)).toThrow(ModelNotFoundError);

      const audit = db.prepare("SELECT action FROM model_change_log ORDER BY id").all() as unknown as Array<{ action: string }>;
      expect(audit.map((a) => a.action)).toEqual(["add", "update", "remove"]);
    } finally {
      cleanup();
    }
  });

  it("rejects duplicate provider/modelId", () => {
    const { db, cleanup } = tempDb();
    try {
      const registry = new ModelRegistry(db);
      const input = {
        name: "dup",
        provider: "p",
        modelId: "m",
        channel: "runtime" as const,
        wireApi: "openai-compatible" as const,
        billing: { type: "free" as const },
        capabilities: { contextWindow: 4096 },
      };
      registry.create(input);
      expect(() => registry.create(input)).toThrow(ModelError);
    } finally {
      cleanup();
    }
  });

  it("rejects invalid billing / capabilities via zod", () => {
    const { db, cleanup } = tempDb();
    try {
      const registry = new ModelRegistry(db);
      expect(() =>
        registry.create({
          name: "bad",
          provider: "p",
          modelId: "m",
          channel: "runtime",
          wireApi: "openai-compatible",
          billing: { type: "nonsense" as never },
          capabilities: { contextWindow: -1 },
        }),
      ).toThrow(ZodError);
    } finally {
      cleanup();
    }
  });
});
