import type { AgentRuntimeConfig, ModelRecord } from "../types.ts";
import { OpenCodeAdapter } from "./opencode.ts";
import { ClaudeAdapter } from "./claude.ts";
import { AdapterError, type AgentAdapter } from "./types.ts";

export class AdapterFactory {
  private readonly agents: AgentRuntimeConfig[];

  constructor(agents: AgentRuntimeConfig[]) {
    this.agents = agents;
  }

  pick(model: ModelRecord): AgentAdapter {
    if (model.channel === "runtime") {
      this.requireAgent("opencode");
      return new OpenCodeAdapter();
    }
    if (model.wireApi === "anthropic") {
      const agent = this.findAgent("claude-code");
      if (!agent) throw new AdapterError("no claude-code agent configured", "AGENT_NOT_CONFIGURED");
      return new ClaudeAdapter({ permissionMode: agent.permissionMode, budgetUsd: agent.budget });
    }
    throw new AdapterError(
      `direct wire_api "${model.wireApi}" adapter not implemented in MVP (use anthropic via claude-code, or runtime channel via opencode)`,
      "ADAPTER_NOT_IMPLEMENTED",
    );
  }

  private findAgent(kind: string): AgentRuntimeConfig | undefined {
    return this.agents.find((a) => a.kind === kind);
  }

  private requireAgent(kind: string): void {
    if (!this.findAgent(kind)) {
      throw new AdapterError(`no ${kind} agent configured in TOML`, "AGENT_NOT_CONFIGURED");
    }
  }
}
