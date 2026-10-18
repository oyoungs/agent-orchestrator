import { describe, expect, it } from "vitest";
import { handleCommand } from "../src/cli/chat.ts";
import type { DaemonClient } from "../src/cli/client.ts";

interface HarnessState {
  session: string | undefined;
  last: string | undefined;
  model: string | undefined;
  requests: Array<{ method: string; path: string }>;
}

function harness() {
  const state: HarnessState = { session: undefined, last: undefined, model: undefined, requests: [] };
  const client: DaemonClient = {
    request: async (method: string, path: string) => {
      state.requests.push({ method, path });
      if (path === "/v1/sessions/s1/clear") return { ok: true, clearedChars: 42 };
      throw new Error(`unexpected request ${method} ${path}`);
    },
  };
  const run = (input: string): Promise<void> =>
    handleCommand(
      client,
      input,
      () => state.session,
      (id) => (state.session = id),
      (id) => (state.last = id),
      (id) => (state.model = id),
    );
  return { state, run };
}

describe("chat command /new", () => {
  it("重置会话与父任务，保留模型偏好，且不发请求", async () => {
    const { state, run } = harness();
    state.session = "s1";
    state.last = "t1";
    state.model = "m1";

    await run("/new");

    expect(state.session).toBeUndefined();
    expect(state.last).toBeUndefined();
    expect(state.model).toBe("m1");
    expect(state.requests).toHaveLength(0);
  });
});

describe("chat command /clear", () => {
  it("清空当前会话上下文并开启新会话", async () => {
    const { state, run } = harness();
    state.session = "s1";
    state.last = "t1";

    await run("/clear");

    expect(state.requests).toEqual([{ method: "POST", path: "/v1/sessions/s1/clear" }]);
    expect(state.session).toBeUndefined();
    expect(state.last).toBeUndefined();
  });

  it("无当前会话时不发请求", async () => {
    const { state, run } = harness();

    await run("/clear");

    expect(state.requests).toHaveLength(0);
    expect(state.session).toBeUndefined();
  });
});

describe("chat command fallback", () => {
  it("未知命令静默返回（提示由 handleCommand 打印）", async () => {
    const { state, run } = harness();
    state.session = "s1";

    await expect(run("/nope")).resolves.toBeUndefined();
    expect(state.requests).toHaveLength(0);
    expect(state.session).toBe("s1");
  });
});
