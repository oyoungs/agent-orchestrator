import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { redactPayload, redactString } from "../security/redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  event: string;
  taskId?: string;
  runId?: string;
  workerId?: string;
  payload?: Record<string, unknown>;
}

export interface Logger {
  log(entry: LogEntry): void;
  debug(event: string, payload?: Record<string, unknown>): void;
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
}

export function createLogger(opts: { stateDir: string; level?: LogLevel }): Logger {
  const levelRank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = levelRank[opts.level ?? "info"];
  const logDir = join(opts.stateDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, "daemon.log");

  const write = (entry: LogEntry): void => {
    if (levelRank[entry.level] < minLevel) return;
    const line = JSON.stringify({ ...entry, payload: entry.payload ? redactPayload(entry.payload) : undefined });
    appendFileSync(file, line + "\n");
    const text = `${entry.level.toUpperCase()} ${entry.event}${entry.taskId ? ` task=${entry.taskId}` : ""}`;
    if (entry.level === "error") console.error(redactString(text));
    else if (entry.level === "warn") console.warn(redactString(text));
    else console.log(redactString(text));
  };

  return {
    log: write,
    debug: (event, payload) => write({ ts: Date.now(), level: "debug", event, payload }),
    info: (event, payload) => write({ ts: Date.now(), level: "info", event, payload }),
    warn: (event, payload) => write({ ts: Date.now(), level: "warn", event, payload }),
    error: (event, payload) => write({ ts: Date.now(), level: "error", event, payload }),
  };
}
