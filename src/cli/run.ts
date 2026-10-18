import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";
import { MarkdownStream, renderMarkdown } from "./markdown.ts";
import {
  ProgressReporter,
  TERMINAL_STATUSES,
  describeTaskProgress,
  parseRoutingInfo,
  pollDelay,
  routingSourceLabel,
  summarizeTaskResult,
} from "./taskProgress.ts";

export async function runTask(client: DaemonClient, prompt: string): Promise<void> {
  const task = await client.request("POST", "/v1/tasks", { prompt, cwd: process.cwd() });
  console.log(`task ${task.id} submitted · type=${task.type}`);
  const progress = new ProgressReporter();
  let mdStream: MarkdownStream | null = null;
  let printed = 0;
  let sawText = false;
  let routingShown = false;

  for (let i = 0; i < 600; i += 1) {
    const current = await client.request("GET", `/v1/tasks/${task.id}`);

    if (!routingShown && current.routingInfo) {
      routingShown = true;
      const info = parseRoutingInfo(current.routingInfo);
      if (info) {
        progress.stop();
        console.log(`已选择模型 ${info.model ?? "-"}（${routingSourceLabel(info.source)}）`);
        progress.reset();
      }
    }

    const line = describeTaskProgress(current);
    if (line) progress.report(line);

    const out = await client.request("GET", `/v1/tasks/${task.id}/output?after=${printed}`);
    if (out.events?.length) {
      for (const ev of out.events) {
        if (ev.type === "text" && ev.text) {
          if (!sawText) {
            progress.stop();
            progress.mute();
            sawText = true;
          }
          if (process.stdout.isTTY) {
            mdStream ??= new MarkdownStream();
            mdStream.append(String(ev.text));
          } else {
            console.log(`  ${String(ev.text)}`);
          }
        } else if (ev.type === "tool") {
          progress.stop();
          const mark = ev.status === "failed" ? "✗" : ev.status === "denied" ? "⛔" : "✓";
          const input = ev.input !== undefined ? ` ${JSON.stringify(ev.input).slice(0, 120)}` : "";
          console.log(`  [工具] ${mark} ${String(ev.tool)}${input}`);
          if (ev.output) {
            const outText = String(ev.output).trim().slice(0, 200);
            if (outText) console.log(`         ${outText.replace(/\n/g, "\n         ")}`);
          }
        } else if (ev.type === "error") {
          progress.stop();
          console.error(`  [错误] ${String(ev.message)}`);
        }
      }
      printed = out.total ?? printed;
    }

    if (TERMINAL_STATUSES.has(current.status)) {
      progress.stop();
      mdStream?.finish();
      printTask(current);
      process.exitCode = current.status === "succeeded" ? 0 : 1;
      return;
    }
    await sleep(pollDelay(i));
  }
  progress.stop();
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
  const view = summarizeTaskResult(t);
  console.log(view.heading);
  if (view.result) {
    if (process.stdout.isTTY) {
      console.log("  result:");
      console.log(renderMarkdown(view.result));
    } else {
      console.log(`  result: ${view.result.slice(0, 500)}`);
    }
  }
  for (const c of view.checks) {
    console.log(`  check ${c.name}: ${c.ok ? "PASS" : "FAIL"}${c.output ? ` — ${String(c.output).slice(0, 120)}` : ""}`);
  }
  if (view.error) console.log(`  error: ${view.error}`);
}
