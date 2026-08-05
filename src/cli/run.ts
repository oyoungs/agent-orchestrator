import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";

const TERMINAL = new Set(["succeeded", "failed", "validation_failed", "cancelled", "timed_out"]);

export async function runTask(client: DaemonClient, prompt: string): Promise<void> {
  const task = await client.request("POST", "/v1/tasks", { prompt });
  console.log(`task ${task.id} submitted · type=${task.type} · model=${task.modelId ?? "-"}`);
  let printed = 0;
  let runningShown = false;
  for (let i = 0; i < 600; i += 1) {
    const current = await client.request("GET", `/v1/tasks/${task.id}`);
    if (!runningShown && (current.status === "running" || TERMINAL.has(current.status))) {
      runningShown = true;
      console.log(`task running · model=${current.modelId ?? "-"}`);
    }
    const out = await client.request("GET", `/v1/tasks/${task.id}/output?after=${printed}`);
    if (out.events?.length) {
      for (const ev of out.events) printEvent(ev);
      printed = out.total ?? printed;
    }
    if (TERMINAL.has(current.status)) {
      printTask(current);
      process.exitCode = current.status === "succeeded" ? 0 : 1;
      return;
    }
    await sleep(1000);
  }
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
      console.log(`  result: ${String(summary.agentResult).slice(0, 500)}`);
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
