// 共享领域类型（ADR-0011/0016/0017）

export type WireApi = "openai-compatible" | "anthropic" | "responses";
export type ModelChannel = "direct" | "runtime";
export type ModelStatus = "active" | "disabled" | "error";
export type BillingType = "free" | "pay-as-you-go" | "subscription" | "token-plan" | "local";
export type TaskType = "refactor" | "fix" | "test" | "review" | "other";
export type TaskStatus =
  | "created"
  | "analyzing"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "validation_failed"
  | "retrying"
  | "interrupted";

export interface UnitPrices {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface Billing {
  type: BillingType;
  unitPrices?: UnitPrices;
  currency?: string;
}

export interface ModelCapabilities {
  contextWindow: number;
  maxOutput?: number;
  toolCalling?: boolean;
  streaming?: boolean;
  reasoning?: boolean;
  modalities?: string[];
}

export interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  /** direct: 用户提供 base_url + 凭据引用；runtime: 由 Agent Runtime 托管认证 */
  channel: ModelChannel;
  wireApi: WireApi;
  baseUrl: string;
  authRef?: string;
  billing: Billing;
  capabilities: ModelCapabilities;
  status: ModelStatus;
  createdAt: number;
  updatedAt: number;
  addedBy?: string;
}

export interface Task {
  id: string;
  parentId: string | null;
  sessionKey: string | null;
  dagGroup: string | null;
  type: TaskType;
  prompt: string;
  status: TaskStatus;
  agentId: string | null;
  modelId: string | null;
  workspaceId: string | null;
  priority: number;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  resultSummary: string | null;
  routingInfo: string | null;
}

export interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  taskCount?: number;
  context?: string;
}

export interface UsageRecord {
  id: string;
  runId: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  latencyMs: number | null;
  costUsd: number | null;
  source: "provider" | "agent-reported";
}

export interface AgentRuntimeConfig {
  id: string;
  kind: "opencode" | "claude-code" | "codex" | "openclaw" | "reasonix";
  permissionMode?: string;
  sandbox?: string;
  gateway?: string;
  agent?: string;
  budget?: number;
}

export interface AppConfig {
  orchestrator: {
    concurrency: number;
    defaultTimeoutSec: number;
    defaultRetries: number;
    sessionContextChars: number;
  };
  daemon: {
    host: string;
    port: number;
  };
  router: {
    freeFirst: boolean;
    escalation: string[];
  };
  workspace: {
    mode: "hybrid" | "copy" | "worktree";
  };
  approvals: {
    requireHuman: string[];
  };
  agents: AgentRuntimeConfig[];
}
