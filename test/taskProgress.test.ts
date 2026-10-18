import { describe, expect, it } from "vitest";
import {
  describeTaskProgress,
  elapsedMs,
  formatDuration,
  pollDelay,
  summarizeTaskResult,
} from "../src/cli/taskProgress.ts";
import type { Task } from "../src/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "12345678-aaaa-bbbb-cccc-dddddddddddd",
    parentId: null,
    sessionKey: null,
    targetDir: null,
    dagGroup: null,
    type: "test",
    prompt: "p",
    status: "created",
    agentId: null,
    modelId: null,
    workspaceId: null,
    priority: 0,
    retryCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    startedAt: null,
    finishedAt: null,
    resultSummary: null,
    routingInfo: null,
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("formats ms, seconds and minutes", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(33)).toBe("33ms");
    expect(formatDuration(1_500)).toBe("1.5s");
    expect(formatDuration(65_000)).toBe("1m5s");
    expect(formatDuration(-1)).toBe("-");
  });
});

describe("pollDelay", () => {
  it("polls fast for the first 10s then slows down", () => {
    expect(pollDelay(0)).toBe(250);
    expect(pollDelay(39)).toBe(250);
    expect(pollDelay(40)).toBe(1_000);
    expect(pollDelay(599)).toBe(1_000);
  });
});

describe("elapsedMs", () => {
  it("uses finishedAt when present, otherwise now", () => {
    expect(elapsedMs(makeTask())).toBeUndefined();
    expect(elapsedMs(makeTask({ startedAt: 1_000, finishedAt: 1_500 }))).toBe(500);
    expect(elapsedMs(makeTask({ startedAt: 1_000 }), 3_000)).toBe(2_000);
  });
});

describe("describeTaskProgress", () => {
  it("describes each non-terminal state", () => {
    expect(describeTaskProgress(makeTask({ status: "created" }), 0)?.key).toBe("created");
    expect(describeTaskProgress(makeTask({ status: "analyzing" }), 0)?.text).toContain("分析中");
    expect(describeTaskProgress(makeTask({ status: "queued" }), 0)?.text).toContain("排队中");
    const running = describeTaskProgress(
      makeTask({ status: "running", startedAt: 1_000, routingInfo: JSON.stringify({ model: "deepseek/x" }) }),
      5_000,
    );
    expect(running?.key).toBe("running");
    expect(running?.text).toContain("deepseek/x");
    expect(running?.text).toContain("已运行 4.0s");
    expect(describeTaskProgress(makeTask({ status: "validating", startedAt: 1_000 }), 2_000)?.text).toContain("验证中");
    expect(describeTaskProgress(makeTask({ status: "retrying" }), 0)?.text).toContain("重试中");
  });

  it("returns null for terminal states", () => {
    expect(describeTaskProgress(makeTask({ status: "succeeded" }), 0)).toBeNull();
    expect(describeTaskProgress(makeTask({ status: "failed" }), 0)).toBeNull();
  });
});

describe("summarizeTaskResult", () => {
  it("surfaces failures instead of staying silent", () => {
    const view = summarizeTaskResult(
      makeTask({
        status: "failed",
        startedAt: 1_000,
        finishedAt: 1_033,
        resultSummary: JSON.stringify({ errorClass: "agent_crash", error: "adapter not implemented" }),
      }),
    );
    expect(view.heading).toContain("failed");
    expect(view.heading).toContain("33ms");
    expect(view.error).toBe("agent_crash — adapter not implemented");
    expect(view.result).toBeUndefined();
  });

  it("includes agent result and validation checks", () => {
    const view = summarizeTaskResult(
      makeTask({
        status: "succeeded",
        startedAt: 1_000,
        finishedAt: 13_000,
        resultSummary: JSON.stringify({
          agentResult: "完成",
          validation: { checks: [{ name: "test", ok: true, output: "ok" }, { name: "lint", ok: false, output: "eslint" }] },
        }),
      }),
    );
    expect(view.result).toBe("完成");
    expect(view.checks).toHaveLength(2);
    expect(view.checks[1]).toEqual({ name: "lint", ok: false, output: "eslint" });
    expect(view.error).toBeUndefined();
  });

  it("explains cancelled tasks", () => {
    const view = summarizeTaskResult(makeTask({ status: "cancelled" }));
    expect(view.error).toBe("任务已取消");
  });

  it("keeps raw summary when JSON is invalid", () => {
    const view = summarizeTaskResult(makeTask({ status: "failed", resultSummary: "not json" }));
    expect(view.error).toBe("not json");
  });
});
