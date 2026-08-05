import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DaemonState {
  port: number;
  tokenFile: string;
  pid: number;
}

export function writeState(stateDir: string, state: DaemonState): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.json"), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function readState(stateDir: string): DaemonState | null {
  try {
    const raw = readFileSync(join(stateDir, "state.json"), "utf8");
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

export function clearState(stateDir: string): void {
  rmSync(join(stateDir, "state.json"), { force: true });
}
