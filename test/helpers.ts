import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ModelRecord } from "../src/types.ts";

export function tempDb(): { db: DatabaseSync; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ao-test-"));
  const db = openDb(join(dir, "test.db"));
  return {
    db,
    dir,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function freeModel(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "m_free",
    name: "free-test",
    provider: "opencode",
    modelId: "test-free",
    channel: "runtime",
    wireApi: "openai-compatible",
    baseUrl: "",
    billing: { type: "free" },
    capabilities: { contextWindow: 128_000, streaming: true },
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function paidModel(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "m_paid",
    name: "paid-test",
    provider: "deepseek",
    modelId: "test-paid",
    channel: "direct",
    wireApi: "anthropic",
    baseUrl: "https://api.example.com/anthropic",
    billing: {
      type: "pay-as-you-go",
      unitPrices: { input: 0.5, output: 1.5 },
      currency: "USD",
    },
    capabilities: { contextWindow: 128_000, toolCalling: true },
    status: "active",
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}
