import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentEvent, AgentTaskInput, AdapterUsage, ProbeResult } from "./types.ts";

interface OpenCodeStepFinish {
  type: "step_finish";
  timestamp?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

interface OpenCodeStepStart {
  type: "step_start";
  timestamp?: number;
}

interface OpenCodeText {
  type: "text";
  timestamp?: number;
  part?: { text?: string };
}

export interface OpenCodeToolUse {
  type: "tool_use";
  timestamp?: number;
  part?: {
    type?: string;
    tool?: string;
    callID?: string;
    state?: { status?: string; input?: unknown; output?: unknown };
  };
}

export type OpenCodeEvent = OpenCodeStepFinish | OpenCodeStepStart | OpenCodeText | OpenCodeToolUse;

/** opencode JSONL 事件 → 统一 AgentEvent（纯函数，便于测试） */
export function openCodeEventToAgentEvent(ev: OpenCodeEvent, modelLabel: string): AgentEvent | null {
  switch (ev.type) {
    case "step_start":
      return { type: "thinking", ts: ev.timestamp ?? Date.now(), model: modelLabel };
    case "text":
      return ev.part?.text ? { type: "text", ts: ev.timestamp ?? Date.now(), text: ev.part.text } : null;
    case "tool_use": {
      const part = ev.part;
      const state = part?.state;
      return {
        type: "tool",
        ts: ev.timestamp ?? Date.now(),
        tool: String(part?.tool ?? "unknown"),
        callId: part?.callID,
        status: state?.status === "error" ? "failed" : state?.status === "running" ? "running" : "completed",
        input: state?.input,
        output: state?.output,
      };
    }
    case "step_finish": {
      const t = ev.tokens ?? {};
      return {
        type: "usage",
        ts: ev.timestamp ?? Date.now(),
        usage: {
          inputTokens: t.input ?? 0,
          outputTokens: t.output ?? 0,
          cacheReadTokens: t.cache?.read ?? 0,
          cacheWriteTokens: t.cache?.write ?? 0,
          reasoningTokens: t.reasoning ?? 0,
        },
      };
    }
    default:
      return null;
  }
}

/** OpenCode 进程适配器：`opencode run --format json`，JSONL 事件流（零成本免费模型可用） */
export class OpenCodeAdapter implements AgentAdapter {
  id = "opencode";

  async *invoke(input: AgentTaskInput): AsyncIterable<AgentEvent> {
    const prompt = input.context ? `${input.context}\n\n${input.prompt}` : input.prompt;
    const modelLabel = `${input.model.provider}/${input.model.modelId}`;
    const args = ["run", prompt, "--format", "json"];
    if (input.model.channel === "runtime" || input.model.wireApi === "openai-compatible") {
      args.push("-m", `${input.model.provider}/${input.model.modelId}`);
    }
    const child = spawn("opencode", args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    yield { type: "started", ts: Date.now() };

    const rl = createInterface({ input: child.stdout });
    let usage: AdapterUsage | undefined;
    const texts: string[] = [];
    for await (const line of rl) {
      if (!line.trim()) continue;
      let ev: OpenCodeEvent | undefined;
      try {
        ev = JSON.parse(line) as OpenCodeEvent;
      } catch {
        continue;
      }
      const agentEvent = openCodeEventToAgentEvent(ev, modelLabel);
      if (!agentEvent) continue;
      if (agentEvent.type === "usage") usage = agentEvent.usage;
      if (agentEvent.type === "text") texts.push(agentEvent.text);
      yield agentEvent;
    }
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    const code = await new Promise<number | null>((resolve) => {
      child.once("close", (c) => resolve(c));
    });
    clearTimeout(timer);

    if (timedOut) {
      yield { type: "error", ts: Date.now(), errorClass: "agent_timeout", message: `opencode exceeded ${input.timeoutMs}ms` };
    } else if (code === 0) {
      yield { type: "finished", ts: Date.now(), exitCode: code, ok: true, result: texts.join("\n"), usage };
    } else {
      yield {
        type: "error",
        ts: Date.now(),
        errorClass: "agent_cli_failure",
        message: `opencode exited ${code}: ${stderrTail.slice(-300) || "no stderr"}`,
      };
    }
  }

  async probe(): Promise<ProbeResult> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      execFile("opencode", ["--version"], { timeout: 10_000 }, (err, stdout) => {
        if (err) resolve({ ok: false, message: err.message });
        else resolve({ ok: true, version: stdout.trim().split("\n")[0] });
      });
    });
  }
}
