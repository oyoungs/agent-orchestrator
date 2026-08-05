import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOutputEvents } from "../src/daemon/output.ts";

describe("readOutputEvents", () => {
  it("reads events with after offset and skips invalid lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-out-"));
    const taskId = "t1";
    mkdirSync(join(dir, "runs", taskId), { recursive: true });
    writeFileSync(
      join(dir, "runs", taskId, "output.jsonl"),
      [
        JSON.stringify({ type: "started", ts: 1 }),
        JSON.stringify({ type: "text", ts: 2, text: "hello" }),
        JSON.stringify({ type: "finished", ts: 3, ok: true }),
        "not-json",
        "",
      ].join("\n"),
    );
    const first = readOutputEvents(dir, taskId, 0);
    expect(first.total).toBe(4);
    expect(first.events).toHaveLength(3);
    const second = readOutputEvents(dir, taskId, 3);
    expect(second.events).toHaveLength(0);
    expect(readOutputEvents(dir, "missing", 0)).toEqual({ total: 0, events: [] });
    rmSync(dir, { recursive: true, force: true });
  });
});
