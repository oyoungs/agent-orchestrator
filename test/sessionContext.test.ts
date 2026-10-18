import { describe, expect, it } from "vitest";
import { appendTurn, buildContextPrompt, truncateFront } from "../src/context/sessionContext.ts";
import { SessionRepo } from "../src/store/sessionRepo.ts";
import { tempDb } from "./helpers.ts";

describe("session context", () => {
  it("accumulates turns with prompt and result", () => {
    const c1 = appendTurn("", "第一问", "第一答");
    expect(c1).toContain("用户: 第一问");
    expect(c1).toContain("结果: 第一答");
    const c2 = appendTurn(c1, "第二问", "第二答");
    expect(c2.indexOf("第二问")).toBeGreaterThan(c1.indexOf("第一问"));
    expect(c2).toContain("第一答");
  });

  it("truncates from front keeping newest content", () => {
    const head = "[较早对话已截断]\n";
    const out = truncateFront("x".repeat(100), 50);
    expect(out.length).toBe(50);
    expect(out.startsWith(head)).toBe(true);
    expect(out.endsWith("x".repeat(50 - head.length))).toBe(true);
  });

  it("builds prompt context or undefined when empty", () => {
    expect(buildContextPrompt("  ")).toBeUndefined();
    expect(buildContextPrompt("内容")).toContain("[历史会话]");
    expect(buildContextPrompt("内容")).toContain("内容");
  });

  it("persists appended turns via SessionRepo", () => {
    const { db, cleanup } = tempDb();
    try {
      const sessions = new SessionRepo(db);
      sessions.ensure("s1", "标题");
      sessions.appendTurn("s1", "问", "答");
      sessions.appendTurn("s1", "问2", "答2");
      const ctx = sessions.getContext("s1");
      expect(ctx).toContain("问");
      expect(ctx).toContain("答2");
      expect(sessions.get("s1")?.context).toBe(ctx);
    } finally {
      cleanup();
    }
  });

  it("clearContext 清空上下文并返回清空前的字符数", () => {
    const { db, cleanup } = tempDb();
    try {
      const sessions = new SessionRepo(db);
      sessions.ensure("s1", "标题");
      sessions.appendTurn("s1", "问", "答");
      const before = sessions.getContext("s1").length;
      expect(sessions.clearContext("s1")).toBe(before);
      expect(sessions.getContext("s1")).toBe("");
      expect(sessions.get("s1")?.context).toBe("");
    } finally {
      cleanup();
    }
  });
});
