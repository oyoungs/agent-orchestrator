import type { ModelRecord } from "../types.ts";

export interface AdapterUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type AgentEvent =
  | { type: "started"; ts: number }
  | { type: "text"; ts: number; text: string }
  | { type: "tool"; ts: number; tool: string; input?: unknown; output?: unknown }
  | { type: "usage"; ts: number; usage: AdapterUsage }
  | { type: "finished"; ts: number; exitCode: number; ok: boolean; result?: string; usage?: AdapterUsage }
  | { type: "error"; ts: number; errorClass: string; message: string };

export interface AgentTaskInput {
  prompt: string;
  cwd: string;
  model: ModelRecord;
  timeoutMs: number;
  env: Record<string, string>;
  budgetUsd?: number;
}

export interface ProbeResult {
  ok: boolean;
  version?: string;
  message?: string;
}

export interface AgentAdapter {
  id: string;
  invoke(input: AgentTaskInput): AsyncIterable<AgentEvent>;
  probe(): Promise<ProbeResult>;
}

export class AdapterError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
