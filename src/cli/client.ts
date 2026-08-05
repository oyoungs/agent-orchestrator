import { STATE_DIR } from "../config/config.ts";
import { readState } from "../daemon/state.ts";
import { readToken } from "../security/token.ts";

export class CliError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export interface DaemonClient {
  request(method: string, path: string, body?: unknown): Promise<any>;
}

export function createClient(): DaemonClient {
  const state = readState(STATE_DIR);
  if (!state) {
    throw new CliError("daemon is not running; start it with `agent daemon start`", "DAEMON_NOT_RUNNING");
  }
  const token = readToken(STATE_DIR);
  if (!token) {
    throw new CliError("daemon token missing; restart daemon", "TOKEN_MISSING");
  }
  return {
    async request(method: string, path: string, body?: unknown): Promise<any> {
      const res = await fetch(`http://127.0.0.1:${state.port}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!res.ok) {
        throw new CliError(data?.error?.message ?? `HTTP ${res.status}`, data?.error?.code ?? "HTTP_ERROR");
      }
      return data;
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
