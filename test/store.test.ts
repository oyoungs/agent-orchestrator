import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.ts";
import { tempDb } from "./helpers.ts";

describe("store", () => {
  it("runs migrations and creates all tables", () => {
    const { db, cleanup } = tempDb();
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as Array<{
        name: string;
      }>;
      const names = rows.map((r) => r.name);
      for (const expected of [
        "tasks",
        "agent_runtimes",
        "models",
        "model_change_log",
        "worker_runs",
        "usage_records",
        "metric_events",
        "schema_migrations",
      ]) {
        expect(names).toContain(expected);
      }
    } finally {
      cleanup();
    }
  });

  it("reopens without re-running migrations", () => {
    const dir = tempDb().dir;
    const db1 = openDb(`${dir}/test.db`);
    const before = (db1.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as unknown as { c: number }).c;
    db1.close();
    const db2 = openDb(`${dir}/test.db`);
    const after = (db2.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as unknown as { c: number }).c;
    db2.close();
    expect(after).toBe(before);
  });
});
