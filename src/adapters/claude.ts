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
  permission_denials?: Array<{ tool?: string; input?: unknown; message?: string }>;
}

export interface ClaudeStreamParse {
  events: AgentEvent[];
  result?: ClaudeResult;
  error?: string;
  texts: string[];
}

/** 解析 claude --output-format stream-json 事件流（纯函数，便于测试） */
export function parseClaudeStreamLines(lines: string[]): ClaudeStreamParse {
  const events: AgentEvent[] = [];
  const texts: string[] = [];
  const toolNames = new Map<string, string>();
  let result: ClaudeResult | undefined;
  let error: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg: {
      type?: string;
      message?: { content?: Array<Record<string, unknown>> };
      result?: string;
      is_error?: boolean;
      usage?: ClaudeResult["usage"];
      api_error_status?: ClaudeResult["api_error_status"];
      permission_denials?: ClaudeResult["permission_denials"];
      error?: unknown;
    };
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof msg.type !== "string") continue;

    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
          events.push({ type: "text", ts: Date.now(), text: block.text });
        } else if (block.type === "tool_use") {
          const callId = String(block.id ?? "");
          const toolName = String(block.name ?? "tool");
          if (callId) toolNames.set(callId, toolName);
          events.push({
            type: "tool",
            ts: Date.now(),
            tool: toolName,
            callId: callId || undefined,
            status: "running",
            input: block.input,
          });
        }
      }
    } else if (msg.type === "user") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_result") {
          const callId = String(block.tool_use_id ?? "");
          const content = Array.isArray(block.content)
            ? block.content
                .map((c) => (typeof c === "string" ? c : ((c as { text?: unknown }).text ?? "")))
                .join("\n")
            : String(block.content ?? "");
          events.push({
            type: "tool",
            ts: Date.now(),
            tool: toolNames.get(callId) ?? "tool",
            callId: callId || undefined,
            status: "completed",
            output: content.slice(0, 4000),
          });
        }
      }
    } else if (msg.type === "result") {
      result = {
        is_error: msg.is_error,
        result: msg.result,
        api_error_status: msg.api_error_status,
        usage: msg.usage,
        permission_denials: msg.permission_denials,
      };
      for (const denial of msg.permission_denials ?? []) {
        events.push({
          type: "tool",
          ts: Date.now(),
          tool: denial.tool ?? "unknown",
          status: "denied",
          input: denial.input,
          output: denial.message,
        });
      }
    } else if (msg.type === "error") {
      error = typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error ?? "unknown error");
    }
  }
  return { events, result, error, texts };
}

/** Claude Code 进程适配器：`claude -p --settings <临时文件> --output-format stream-json`（Anthropic 兼容端点注入） */
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

    const prompt = input.context ? `${input.context}\n\n${input.prompt}` : input.prompt;
    const args = ["-p", prompt, "--settings", settingsPath, "--output-format", "stream-json"];
    if (this.opts.permissionMode) args.push("--permission-mode", this.opts.permissionMode);
    args.push("--max-budget-usd", String(this.opts.budgetUsd ?? 0.5));

    yield { type: "started", ts: Date.now() };
    yield { type: "thinking", ts: Date.now(), model: `${input.model.provider}/${input.model.modelId}` };
    try {
      const lines = await this.runClaude(args, input.cwd, input.timeoutMs, settingsPath);
      const parsed = parseClaudeStreamLines(lines);
      if (parsed.error) {
        yield { type: "error", ts: Date.now(), errorClass: "model_error", message: parsed.error };
        return;
      }
      if (parsed.result?.is_error) {
        yield {
          type: "error",
          ts: Date.now(),
          errorClass: "auth_error",
          message: parsed.result.api_error_status?.message ?? parsed.result.result ?? "claude returned an error",
        };
        return;
      }
      for (const event of parsed.events) yield event;
      const usage: AdapterUsage = {
        inputTokens: parsed.result?.usage?.input_tokens ?? 0,
        outputTokens: parsed.result?.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.result?.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: parsed.result?.usage?.cache_creation_input_tokens ?? 0,
      };
      yield { type: "usage", ts: Date.now(), usage };
      const text = parsed.result?.result ?? parsed.texts.join("\n");
      yield { type: "finished", ts: Date.now(), exitCode: 0, ok: true, result: text, usage };
    } catch (err) {
      yield { type: "error", ts: Date.now(), errorClass: "agent_crash", message: (err as Error).message };
    } finally {
      if (existsSync(settingsPath)) rmSync(settingsPath, { force: true });
    }
  }

  private runClaude(args: string[], cwd: string, timeoutMs: number, settingsPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        cwd,
        env: { ...process.env, PWD: cwd },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines: string[] = [];
      let stderrTail = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        const text = d.toString();
        for (const part of text.split("\n")) {
          const trimmed = part.trim();
          if (trimmed) lines.push(trimmed);
        }
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
        resolve(lines);
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
