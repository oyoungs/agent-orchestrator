import { describe, expect, it } from "vitest";
import { parseClaudeStreamLines } from "../src/adapters/claude.ts";

describe("claude stream parsing", () => {
  it("extracts text, tool_use, tool_result and final result", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "开始" },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "file1" }] }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "完成",
        usage: { input_tokens: 10, output_tokens: 5 },
        permission_denials: [],
      }),
    ];
    const parsed = parseClaudeStreamLines(lines);
    expect(parsed.result?.result).toBe("完成");
    expect(parsed.result?.usage?.input_tokens).toBe(10);
    const tools = parsed.events.filter((e) => e.type === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ type: "tool", tool: "Bash", status: "running", callId: "toolu_1" });
    expect(tools[1]).toMatchObject({ type: "tool", tool: "Bash", status: "completed", output: "file1" });
    expect(parsed.events.some((e) => e.type === "text" && e.text === "开始")).toBe(true);
  });

  it("emits denied tool events from permission_denials", () => {
    const parsed = parseClaudeStreamLines([
      JSON.stringify({
        type: "result",
        is_error: false,
        result: "x",
        permission_denials: [{ tool: "Bash", input: { command: "rm -rf /" }, message: "denied by policy" }],
      }),
    ]);
    const denied = parsed.events.find((e) => e.type === "tool" && e.status === "denied");
    expect(denied).toMatchObject({ type: "tool", tool: "Bash", status: "denied", output: "denied by policy" });
  });

  it("surfaces stream errors", () => {
    const parsed = parseClaudeStreamLines([JSON.stringify({ type: "error", error: { message: "boom" } })]);
    expect(parsed.error).toContain("boom");
  });
});
