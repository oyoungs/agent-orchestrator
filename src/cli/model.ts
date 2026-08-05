import type { DaemonClient } from "./client.ts";

export interface ModelAddOptions {
  name?: string;
  provider: string;
  modelId: string;
  channel: string;
  wireApi: string;
  baseUrl?: string;
  authEnv?: string;
  billing: string;
  priceInput?: number;
  priceOutput?: number;
  priceCacheRead?: number;
  contextWindow?: number;
  maxOutput?: number;
  toolCalling?: boolean;
  streaming?: boolean;
  reasoning?: boolean;
}

export async function addModel(client: DaemonClient, opts: ModelAddOptions): Promise<any> {
  const body = {
    name: opts.name ?? `${opts.provider}/${opts.modelId}`,
    provider: opts.provider,
    modelId: opts.modelId,
    channel: opts.channel,
    wireApi: opts.wireApi,
    baseUrl: opts.baseUrl,
    authRef: opts.authEnv,
    billing: {
      type: opts.billing,
      ...(opts.priceInput !== undefined || opts.priceOutput !== undefined
        ? {
            unitPrices: {
              input: opts.priceInput ?? 0,
              output: opts.priceOutput ?? 0,
              ...(opts.priceCacheRead !== undefined ? { cacheRead: opts.priceCacheRead } : {}),
            },
            currency: "USD",
          }
        : {}),
    },
    capabilities: {
      contextWindow: opts.contextWindow ?? 32_768,
      ...(opts.maxOutput !== undefined ? { maxOutput: opts.maxOutput } : {}),
      toolCalling: opts.toolCalling ?? false,
      streaming: opts.streaming ?? true,
      reasoning: opts.reasoning ?? false,
    },
  };
  return client.request("POST", "/v1/models", body);
}

export async function listModels(client: DaemonClient): Promise<any[]> {
  return client.request("GET", "/v1/models") as Promise<any[]>;
}

export async function updateModel(client: DaemonClient, id: string, patch: Record<string, unknown>): Promise<any> {
  return client.request("PATCH", `/v1/models/${id}`, patch);
}

export async function removeModel(client: DaemonClient, id: string): Promise<any> {
  return client.request("DELETE", `/v1/models/${id}`);
}

export function formatModel(m: any): string {
  const price = m.billing?.unitPrices
    ? ` in=${m.billing.unitPrices.input} out=${m.billing.unitPrices.output}`
    : "";
  return `${m.id}  ${m.name}  [${m.channel}/${m.wireApi}] ${m.status} billing=${m.billing.type}${price} ctx=${m.capabilities?.contextWindow ?? "?"}`;
}
