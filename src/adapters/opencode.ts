import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentAdapter, AgentEvent, AgentTaskInput, AdapterUsage, ProbeResult } from "./types.ts";

interface OpenCodeStepFinish {
  type: "step_finish";
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

interface OpenCodeText {
  type: "text";
  part?: { text?: string };
}

/** OpenCode 进程适配器：`opencode run --format json`，JSONL 事件流（零成本免费模型可用） */
export class OpenCodeAdapter implements AgentAdapter {
  id = "opencode";

  async *invoke(input: AgentTaskInput): AsyncIterable<AgentEvent> {
    const args = ["run", input.prompt, "--format", "json"];
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
      let ev: OpenCodeStepFinish | OpenCodeText | undefined;
      try {
        ev = JSON.parse(line) as OpenCodeStepFinish | OpenCodeText;
      } catch {
        continue;
      }
      if (ev.type === "text" && ev.part?.text) {
        texts.push(ev.part.text);
        yield { type: "text", ts: Date.now(), text: ev.part.text };
      } else if (ev.type === "step_finish") {
        const t = ev.tokens ?? {};
        usage = {
          inputTokens: t.input ?? 0,
          outputTokens: t.output ?? 0,
          cacheReadTokens: t.cache?.read ?? 0,
          cacheWriteTokens: t.cache?.write ?? 0,
          reasoningTokens: t.reasoning ?? 0,
        };
        yield { type: "usage", ts: Date.now(), usage };
      }
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
