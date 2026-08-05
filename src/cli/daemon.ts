import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ROOT, STATE_DIR } from "../config/config.ts";
import { readState } from "../daemon/state.ts";
import { readToken } from "../security/token.ts";
import { CliError, createClient, sleep } from "./client.ts";

const MAIN_TS = fileURLToPath(new URL("../daemon/main.ts", import.meta.url));

export async function startDaemon(): Promise<void> {
  const existing = readState(STATE_DIR);
  if (existing) {
    const token = readToken(STATE_DIR);
    if (token) {
      try {
        const res = await fetch(`http://127.0.0.1:${existing.port}/v1/health`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (res.ok) throw new CliError(`daemon already running (pid=${existing.pid}, port=${existing.port})`, "ALREADY_RUNNING");
      } catch (err) {
        if (err instanceof CliError) throw err;
        // stale state，继续启动
      }
    }
  }
  mkdirSync(join(STATE_DIR, "logs"), { recursive: true });
  const outFd = openSync(join(STATE_DIR, "logs", "daemon.out.log"), "a");
  const child = spawn(process.execPath, [MAIN_TS], {
    detached: true,
    stdio: ["ignore", outFd, outFd],
    cwd: PROJECT_ROOT,
    env: { ...process.env },
  });
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    const state = readState(STATE_DIR);
    if (!state) continue;
    const token = readToken(STATE_DIR);
    try {
      const res = await fetch(`http://127.0.0.1:${state.port}/v1/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        console.log(`daemon started (pid=${state.pid}, port=${state.port})`);
        return;
      }
    } catch {
      // not ready yet
    }
  }
  throw new CliError("daemon failed to start; check .agent-orchestrator/logs/daemon.log", "DAEMON_START_FAILED");
}

export async function stopDaemon(): Promise<void> {
  const client = createClient();
  await client.request("POST", "/v1/shutdown");
  for (let i = 0; i < 20; i += 1) {
    await sleep(250);
    if (!readState(STATE_DIR)) {
      console.log("daemon stopped");
      return;
    }
  }
  throw new CliError("daemon did not stop in time", "DAEMON_STOP_TIMEOUT");
}

export async function daemonStatus(): Promise<void> {
  const state = readState(STATE_DIR);
  if (!state) {
    console.log("daemon: not running");
    return;
  }
  const token = readToken(STATE_DIR);
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/v1/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      console.log(`daemon: running (pid=${state.pid}, port=${state.port})`);
      return;
    }
  } catch {
    // fallthrough
  }
  console.log(`daemon: state file exists but unhealthy (pid=${state.pid}); remove .agent-orchestrator/state.json if stale`);
}
