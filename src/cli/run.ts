import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";
import { Spinner } from "./spinner.ts";
import { MarkdownStream, renderMarkdown } from "./markdown.ts";

const TERMINAL = new Set(["succeeded", "failed", "validation_failed", "cancelled", "timed_out"]);

export async function runTask(client: DaemonClient, prompt: string): Promise<void> {
  const task = await client.request("POST", "/v1/tasks", { prompt });
  console.log(`task ${task.id} submitted · type=${task.type}${task.status === "analyzing" ? " · analyzing" : ""}`);
  const spinner = new Spinner();
  let mdStream: MarkdownStream | null = null;
  let printed = 0;
  let analysisShown = false;
  let routingShown = false;
  let thinkingShown = false;
  let sawText = false;
  let routingModel: string | undefined;
  for (let i = 0; i < 600; i += 1) {
    const current = await client.request("GET", `/v1/tasks/${task.id}`);
    if (!analysisShown && current.status === "analyzing") {
      analysisShown = true;
      spinner.start("分析中…（免费模型）");
    } else if (!routingShown && current.routingInfo) {
      routingShown = true;
      spinner.stop();
      try {
        const info = JSON.parse(current.routingInfo) as { model?: string; source?: string };
        routingModel = info.model;
        console.log(`已选择模型 ${info.model ?? "-"}（${info.source === "free-model" ? "免费模型分析" : "规则路由"}）`);
      } catch {
        console.log("已选择模型（路由完成）");
      }
    }
    if (!thinkingShown && current.status === "running") {
      thinkingShown = true;
      spinner.start(`模型 ${routingModel ?? "…"} 正在思考`);
    }
    const out = await client.request("GET", `/v1/tasks/${task.id}/output?after=${printed}`);
    if (out.events?.length) {
      for (const ev of out.events) {
        if (ev.type === "thinking" && !sawText) spinner.start(`模型 ${ev.model} 正在思考`);
        if (ev.type === "text" && ev.text) {
          if (!sawText) spinner.stop();
          sawText = true;
          if (process.stdout.isTTY) {
            mdStream ??= new MarkdownStream();
            mdStream.append(String(ev.text));
          } else {
            console.log(`  ${String(ev.text)}`);
          }
        } else if (ev.type === "tool") {
          spinner.stop();
          console.log(`  [tool] ${String(ev.tool)}`);
        } else if (ev.type === "error") {
          spinner.stop();
          console.error(`  [error] ${String(ev.message)}`);
        }
      }
      printed = out.total ?? printed;
    }
    if (TERMINAL.has(current.status)) {
      spinner.stop();
      mdStream?.finish();
      printTask(current);
      process.exitCode = current.status === "succeeded" ? 0 : 1;
      return;
    }
    await sleep(1000);
  }
  spinner.stop();
  console.error("task did not finish within polling window");
  process.exitCode = 1;
}

export async function statusTask(client: DaemonClient, taskId?: string): Promise<void> {
  if (taskId) {
    const task = await client.request("GET", `/v1/tasks/${taskId}`);
    printTask(task);
    const out = await client.request("GET", `/v1/tasks/${taskId}/output`);
    if (out.events?.length) {
      console.log("  — 执行过程 —");
      for (const ev of out.events) printEvent(ev);
    }
    return;
  }
  const tasks = await client.request("GET", "/v1/tasks");
  if (tasks.length === 0) {
    console.log("no tasks yet");
    return;
  }
  for (const t of tasks) printTask(t);
}

function printEvent(ev: { type?: string; text?: unknown; tool?: unknown; input?: unknown; message?: unknown }): void {
  if (ev.type === "text" && ev.text) {
    console.log(`  ${String(ev.text)}`);
  } else if (ev.type === "tool") {
    const input = ev.input !== undefined ? ` ${JSON.stringify(ev.input).slice(0, 160)}` : "";
    console.log(`  [tool] ${String(ev.tool)}${input}`);
  } else if (ev.type === "error") {
    console.error(`  [error] ${String(ev.message)}`);
  }
}

function printTask(t: any): void {
  console.log(`task ${t.id} · ${t.type} · ${t.status} · model=${t.modelId ?? "-"}`);
  if (!t.resultSummary) return;
  try {
    const summary = JSON.parse(t.resultSummary);
    if (summary.agentResult !== undefined && summary.agentResult !== null) {
      if (process.stdout.isTTY) {
        console.log("  result:");
        console.log(renderMarkdown(String(summary.agentResult)));
      } else {
        console.log(`  result: ${String(summary.agentResult).slice(0, 500)}`);
      }
    }
    if (summary.validation?.checks) {
      for (const c of summary.validation.checks) {
        console.log(
          `  check ${c.name}: ${c.ok ? "PASS" : "FAIL"}${c.output ? ` — ${String(c.output).slice(0, 120)}` : ""}`,
        );
      }
    } else if (summary.checks) {
      for (const c of summary.checks) {
        console.log(
          `  check ${c.name}: ${c.ok ? "PASS" : "FAIL"}${c.output ? ` — ${String(c.output).slice(0, 120)}` : ""}`,
        );
      }
    } else if (summary.errorClass) {
      console.log(`  error: ${summary.errorClass} — ${String(summary.error ?? "").slice(0, 300)}`);
    } else {
      console.log(`  ${JSON.stringify(summary).slice(0, 300)}`);
    }
  } catch {
    console.log(`  ${String(t.resultSummary).slice(0, 300)}`);
  }
}
