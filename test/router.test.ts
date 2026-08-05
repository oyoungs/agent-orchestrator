import { describe, expect, it } from "vitest";
import { NoModelsError, Router } from "../src/router/router.ts";
import { freeModel, paidModel } from "./helpers.ts";

describe("Router", () => {
  const router = new Router();

  it("classifies prompts by keyword", () => {
    expect(router.classify("重构这个模块")).toBe("refactor");
    expect(router.classify("修复登录 bug")).toBe("fix");
    expect(router.classify("为 utils 添加单测")).toBe("test");
    expect(router.classify("帮我 review 这段代码")).toBe("review");
    expect(router.classify("写一份说明文档")).toBe("other");
  });

  it("picks free-first model and builds escalation list", () => {
    const plan = router.plan("修复一个 bug", [paidModel(), freeModel()]);
    expect(plan.candidates[0]?.id).toBe("m_free");
    expect(plan.escalation[0]?.id).toBe("m_paid");
    expect(plan.type).toBe("fix");
  });

  it("throws NoModelsError when registry is empty", () => {
    expect(() => router.plan("任何任务", [])).toThrow(NoModelsError);
  });
});
