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
  orchestrator: { concurrency: 2, defaultTimeoutSec: 300, defaultRetries: 1 },
  daemon: { host: "127.0.0.1", port: 43999 },
  router: { freeFirst: true, escalation: ["flash", "pro", "strongest"] },
  workspace: { mode: "copy" },
  approvals: { requireHuman: ["git:push", "network", "fs:write-outside-workspace"] },
  agents: [],
};

export function loadConfig(path = DEFAULT_CONFIG_PATH): AppConfig {
  if (!existsSync(path)) return DEFAULTS;
  const raw = readFileSync(path, "utf8");
  const parsed = parse(raw) as Partial<AppConfig>;
  return {
    orchestrator: { ...DEFAULTS.orchestrator, ...parsed.orchestrator },
    daemon: { ...DEFAULTS.daemon, ...parsed.daemon },
    router: { ...DEFAULTS.router, ...parsed.router },
    workspace: { ...DEFAULTS.workspace, ...parsed.workspace },
    approvals: { ...DEFAULTS.approvals, ...parsed.approvals },
    agents: parsed.agents ?? [],
  };
}
