import type { ModelRecord, TaskType } from "../types.ts";
import type { TaskAnalysis } from "./analyzer.ts";

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

export interface ModelSelection {
  model: ModelRecord;
  escalation: ModelRecord[];
  source: "rules" | "free-model";
  analysis: TaskAnalysis | null;
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
    const selection = this.selectModel(prompt, models, null);
    return {
      type: this.classify(prompt),
      complexity: this.complexity(prompt),
      candidates: [selection.model, ...selection.escalation],
      escalation: selection.escalation,
    };
  }

  /** 模型选择：免费模型分析（可选）→ 能力过滤 → 推荐优先 → 成本排序 */
  selectModel(prompt: string, models: ModelRecord[], analysis: TaskAnalysis | null): ModelSelection {
    const active = models.filter((m) => m.status === "active");
    if (active.length === 0) throw new NoModelsError();
    const byCost = [...active].sort(costSort);
    if (!analysis) {
      return { model: byCost[0] as ModelRecord, escalation: byCost.slice(1), source: "rules", analysis: null };
    }
    const required = analysis.capabilities ?? [];
    const capable = active.filter((m) => capabilitiesMatch(m, required));
    const pool = capable.length > 0 ? capable : active;
    const recommended = analysis.recommendation
      ? pool.find(
          (m) =>
            m.modelId === analysis.recommendation ||
            `${m.provider}/${m.modelId}` === analysis.recommendation ||
            m.id === analysis.recommendation,
        )
      : undefined;
    const ordered = [...pool].sort((a, b) => {
      if (recommended && a.id === recommended.id) return -1;
      if (recommended && b.id === recommended.id) return 1;
      return costSort(a, b);
    });
    return { model: ordered[0] as ModelRecord, escalation: ordered.slice(1), source: "free-model", analysis };
  }
}

function costSort(a: ModelRecord, b: ModelRecord): number {
  const ra = costRank(a);
  const rb = costRank(b);
  if (ra.group !== rb.group) return ra.group - rb.group;
  if (ra.price !== rb.price) return ra.price - rb.price;
  return a.name.localeCompare(b.name);
}

function capabilitiesMatch(model: ModelRecord, required: string[]): boolean {
  return required.every((cap) => {
    switch (cap) {
      case "tool_calling":
        return model.capabilities.toolCalling === true;
      case "reasoning":
        return model.capabilities.reasoning === true;
      case "streaming":
        return model.capabilities.streaming !== false;
      case "large_context":
        return (model.capabilities.contextWindow ?? 0) >= 128_000;
      case "vision":
        return (model.capabilities.modalities ?? []).includes("image");
      default:
        return true;
    }
  });
}
