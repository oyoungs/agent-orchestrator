import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeAdapter } from "../adapters/opencode.ts";
import type { ModelRecord } from "../types.ts";

export interface TaskAnalysis {
  type: string;
  complexity: "low" | "medium" | "high";
  capabilities: string[];
  recommendation?: string;
  reason: string;
}

const ROUTING_PROMPT = `你是任务路由分析器。分析下面的用户任务，只输出一个 JSON 对象，不要输出其他内容。
JSON 字段：
- type: 任务类型，取值为 "refactor" | "fix" | "test" | "review" | "other"
- complexity: "low" | "medium" | "high"
- capabilities: 该任务需要模型具备的能力数组，从以下值中选择（可多选）："tool_calling"（需要修改文件/执行命令）、"reasoning"（需要深度推理）、"streaming"（需要流式输出）、"large_context"（需要至少 128K 上下文）、"vision"（需要图像输入）
- recommendation: 你建议的模型 ID 或 provider/model（如果注册表里有明显更适合的模型，给出它的 modelId；不确定则不填）
- reason: 一句话说明选择依据

用户任务：`;

/** 解析模型输出中的 JSON（容忍代码块包裹与前后杂讯） */
export function parseAnalysis(raw: string): TaskAnalysis | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Partial<TaskAnalysis>;
    if (typeof obj.type !== "string" || typeof obj.reason !== "string") return null;
    return {
      type: obj.type,
      complexity: obj.complexity === "low" || obj.complexity === "medium" || obj.complexity === "high" ? obj.complexity : "medium",
      capabilities: Array.isArray(obj.capabilities) ? obj.capabilities.map(String) : [],
      recommendation: typeof obj.recommendation === "string" ? obj.recommendation : undefined,
      reason: obj.reason,
    };
  } catch {
    return null;
  }
}

/** 用免费模型分析任务（零成本）；失败返回 null，调用方回退到规则路由 */
export async function analyzeWithFreeModel(
  prompt: string,
  freeModel: ModelRecord,
  timeoutMs = 90_000,
): Promise<TaskAnalysis | null> {
  const cwd = mkdtempSync(join(tmpdir(), "ao-analyze-"));
  try {
    const adapter = new OpenCodeAdapter();
    const texts: string[] = [];
    for await (const event of adapter.invoke({
      prompt: `${ROUTING_PROMPT}${prompt}`,
      cwd,
      model: freeModel,
      timeoutMs,
      env: {},
    })) {
      if (event.type === "text") texts.push(event.text);
      if (event.type === "error") return null;
    }
    return parseAnalysis(texts.join("\n"));
  } catch {
    return null;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
