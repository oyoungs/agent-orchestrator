import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentEvent, AgentTaskInput, AdapterUsage, ProbeResult } from "./types.ts";
import { AdapterError } from "./types.ts";

interface ClaudeResult {
  is_error?: boolean;
  result?: string;
  api_error_status?: { message?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Claude Code 进程适配器：`claude -p --settings <临时文件> --output-format json`（Anthropic 兼容端点注入） */
export class ClaudeAdapter implements AgentAdapter {
  id = "claude-code";
  private readonly opts: { permissionMode?: string; budgetUsd?: number };

  constructor(opts: { permissionMode?: string; budgetUsd?: number } = {}) {
    this.opts = opts;
  }

  async *invoke(input: AgentTaskInput): AsyncIterable<AgentEvent> {
    if (input.model.channel !== "direct") {
      throw new AdapterError("claude adapter requires a direct-channel model", "INVALID_CHANNEL");
    }
    if (!input.model.baseUrl) {
      throw new AdapterError("claude adapter requires base-url for anthropic-compatible endpoint", "MISSING_BASE_URL");
    }
    const token = input.model.authRef ? process.env[input.model.authRef] : undefined;
    const settings = {
      env: {
        ANTHROPIC_BASE_URL: input.model.baseUrl,
        ANTHROPIC_MODEL: input.model.modelId,
        ...(token ? { ANTHROPIC_AUTH_TOKEN: token } : {}),
      },
      includeCoAuthoredBy: false,
    };
    const settingsPath = join(input.cwd, ".agent-orchestrator-claude-settings.json");
    writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });

    const args = ["-p", input.prompt, "--settings", settingsPath, "--output-format", "json"];
    if (this.opts.permissionMode) args.push("--permission-mode", this.opts.permissionMode);
    args.push("--max-budget-usd", String(this.opts.budgetUsd ?? 0.5));

    yield { type: "started", ts: Date.now() };
    try {
      const result = await this.runClaude(args, input.cwd, input.timeoutMs, settingsPath);
      if (result.is_error) {
        yield {
          type: "error",
          ts: Date.now(),
          errorClass: "auth_error",
          message: result.api_error_status?.message ?? result.result ?? "claude returned an error",
        };
        return;
      }
      const text = result.result ?? "";
      const usage: AdapterUsage = {
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: result.usage?.cache_creation_input_tokens ?? 0,
      };
      if (text) yield { type: "text", ts: Date.now(), text };
      yield { type: "usage", ts: Date.now(), usage };
      yield { type: "finished", ts: Date.now(), exitCode: 0, ok: true, result: text, usage };
    } catch (err) {
      yield { type: "error", ts: Date.now(), errorClass: "agent_crash", message: (err as Error).message };
    } finally {
      if (existsSync(settingsPath)) rmSync(settingsPath, { force: true });
    }
  }

  private runClaude(args: string[], cwd: string, timeoutMs: number, settingsPath: string): Promise<ClaudeResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderrTail = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-2000);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`claude exceeded ${timeoutMs}ms`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${stderrTail.slice(-300)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ClaudeResult);
        } catch {
          reject(new Error(`claude returned non-JSON output: ${stdout.slice(-300) || stderrTail.slice(-300)}`));
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async probe(): Promise<ProbeResult> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      execFile("claude", ["--version"], { timeout: 10_000 }, (err, stdout) => {
        if (err) resolve({ ok: false, message: err.message });
        else resolve({ ok: true, version: stdout.trim().split("\n")[0] });
      });
    });
  }
}
