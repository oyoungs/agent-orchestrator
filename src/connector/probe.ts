import type { ModelRecord } from "../types.ts";
import type { Logger } from "../observability/logger.ts";

export interface ProbeOutcome {
  ok: boolean;
  status?: number;
  message?: string;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path, base).toString();
}

/** 模型连接探测：默认 OpenAI 兼容（GET /models）；runtime channel 无需探测 */
export async function probeModel(model: ModelRecord, logger: Logger): Promise<ProbeOutcome> {
  if (model.channel === "runtime") {
    return { ok: true, message: "runtime channel: 认证由 Agent Runtime 托管，无需探测" };
  }
  if (model.wireApi !== "openai-compatible") {
    return { ok: false, message: `probe 暂未实现 wire_api=${model.wireApi}` };
  }
  const token = model.authRef ? process.env[model.authRef] : undefined;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(joinUrl(model.baseUrl, "models"), {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) {
      logger.warn("model.probe.auth_failed", { modelId: model.id, status: res.status });
      return { ok: false, status: res.status, message: "认证失败（401/403），请检查凭据" };
    }
    return { ok: false, status: res.status, message: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
