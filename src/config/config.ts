import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import type { AppConfig } from "../types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..", "..");
export const STATE_DIR = join(PROJECT_ROOT, ".agent-orchestrator");
export const DEFAULT_CONFIG_PATH = join(PROJECT_ROOT, "config", "agent-orchestrator.toml");

const DEFAULTS: AppConfig = {
  orchestrator: { concurrency: 2, defaultTimeoutSec: 300, defaultRetries: 1, sessionContextChars: 12_000 },
  daemon: { host: "127.0.0.1", port: 43999 },
  router: { freeFirst: true, escalation: ["flash", "pro", "strongest"] },
  workspace: { mode: "copy" },
  approvals: { requireHuman: ["git:push", "network", "fs:write-outside-workspace"] },
  agents: [],
};

export function loadConfig(path = DEFAULT_CONFIG_PATH): AppConfig {
  if (!existsSync(path)) return DEFAULTS;
  const raw = readFileSync(path, "utf8");
  const parsed = parse(raw) as {
    orchestrator?: {
      concurrency?: number;
      default_timeout_sec?: number;
      default_retries?: number;
      session_context_chars?: number;
    };
    daemon?: { host?: string; port?: number };
    router?: { free_first?: boolean; escalation?: string[] };
    workspace?: { mode?: "hybrid" | "copy" | "worktree" };
    approvals?: { require_human?: string[] };
    agents?: AppConfig["agents"];
  };
  return {
    orchestrator: {
      concurrency: parsed.orchestrator?.concurrency ?? DEFAULTS.orchestrator.concurrency,
      defaultTimeoutSec: parsed.orchestrator?.default_timeout_sec ?? DEFAULTS.orchestrator.defaultTimeoutSec,
      defaultRetries: parsed.orchestrator?.default_retries ?? DEFAULTS.orchestrator.defaultRetries,
      sessionContextChars: parsed.orchestrator?.session_context_chars ?? DEFAULTS.orchestrator.sessionContextChars,
    },
    daemon: { host: parsed.daemon?.host ?? DEFAULTS.daemon.host, port: parsed.daemon?.port ?? DEFAULTS.daemon.port },
    router: {
      freeFirst: parsed.router?.free_first ?? DEFAULTS.router.freeFirst,
      escalation: parsed.router?.escalation ?? DEFAULTS.router.escalation,
    },
    workspace: { mode: parsed.workspace?.mode ?? DEFAULTS.workspace.mode },
    approvals: { requireHuman: parsed.approvals?.require_human ?? DEFAULTS.approvals.requireHuman },
    agents: parsed.agents ?? [],
  };
}
