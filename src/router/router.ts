import type { ModelRecord, TaskType } from "../types.ts";

export class RouterError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class NoModelsError extends RouterError {
  constructor() {
    super("no active models registered; run `agent model add` first", "NO_MODELS");
  }
}

export interface TaskProfile {
  type: TaskType;
  complexity: "low" | "medium" | "high";
  candidates: ModelRecord[];
  escalation: ModelRecord[];
}

const KEYWORDS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  { type: "refactor", patterns: [/重构/i, /refactor/i, /重写/i, /整理代码/i] },
  { type: "review", patterns: [/审查/i, /review/i, /评审/i, /检查代码/i] },
  { type: "fix", patterns: [/修复/i, /修 bug/i, /\bfix\b/i, /\bbug\b/i, /异常/i] },
  { type: "test", patterns: [/测试/i, /\btest\b/i, /单测/i, /用例/i, /coverage/i] },
];

/** 成本排名：越低越优先（free/local 计划内模型优先，pay-as-you-go 按输入单价） */
export function costRank(model: ModelRecord): { group: number; price: number } {
  const type = model.billing.type;
  const group = type === "free" || type === "local" ? 0 : type === "subscription" || type === "token-plan" ? 1 : 2;
  const price = model.billing.unitPrices?.input ?? 0;
  return { group, price };
}

export class Router {
  classify(prompt: string): TaskType {
    for (const rule of KEYWORDS) {
      if (rule.patterns.some((p) => p.test(prompt))) return rule.type;
    }
    return "other";
  }

  complexity(prompt: string): "low" | "medium" | "high" {
    const len = prompt.length;
    if (len > 300) return "high";
    if (len > 100) return "medium";
    return "low";
  }

  plan(prompt: string, models: ModelRecord[]): TaskProfile {
    const active = models.filter((m) => m.status === "active");
    if (active.length === 0) throw new NoModelsError();
    const sorted = [...active].sort((a, b) => {
      const ra = costRank(a);
      const rb = costRank(b);
      if (ra.group !== rb.group) return ra.group - rb.group;
      if (ra.price !== rb.price) return ra.price - rb.price;
      return a.name.localeCompare(b.name);
    });
    return {
      type: this.classify(prompt),
      complexity: this.complexity(prompt),
      candidates: sorted,
      escalation: sorted.slice(1),
    };
  }
}
