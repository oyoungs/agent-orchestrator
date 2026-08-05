import { describe, expect, it } from "vitest";
import { openCodeEventToAgentEvent } from "../src/adapters/opencode.ts";

describe("opencode event mapping", () => {
  it("maps tool_use to a tool event", () => {
    const ev = openCodeEventToAgentEvent(
      {
        type: "tool_use",
        timestamp: 1000,
        part: {
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: { status: "completed", input: { command: "ls -la" }, output: "total 240" },
        },
      },
      "m",
    );
    expect(ev).toEqual({
      type: "tool",
      ts: 1000,
      tool: "bash",
      callId: "call_1",
      status: "completed",
      input: { command: "ls -la" },
      output: "total 240",
    });
  });

  it("maps step_finish to usage and step_start to thinking", () => {
    const finish = openCodeEventToAgentEvent(
      { type: "step_finish", timestamp: 2, tokens: { input: 10, output: 3, cache: { read: 4 } } },
      "m",
    );
    expect(finish).toMatchObject({ type: "usage" });
    expect(finish?.type === "usage" ? finish.usage.inputTokens : null).toBe(10);
    const start = openCodeEventToAgentEvent({ type: "step_start", timestamp: 1 }, "m");
    expect(start).toEqual({ type: "thinking", ts: 1, model: "m" });
  });

  it("ignores unknown event types", () => {
    expect(openCodeEventToAgentEvent({ type: "whatever" } as never, "m")).toBeNull();
  });
});
