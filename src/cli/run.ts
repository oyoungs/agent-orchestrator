import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";

const TERMINAL = new Set(["succeeded", "failed", "validation_failed", "cancelled", "timed_out"]);

export async function runTask(client: DaemonClient, prompt: string): Promise<void> {
  const task = await client.request("POST", "/v1/tasks", { prompt });
  console.log(`task ${task.id} submitted · type=${task.type} · model=${task.modelId ?? "-"}`);
  for (let i = 0; i < 600; i += 1) {
    await sleep(1000);
    const current = await client.request("GET", `/v1/tasks/${task.id}`);
    if (TERMINAL.has(current.status)) {
      printTask(current);
      process.exitCode = current.status === "succeeded" ? 0 : 1;
      return;
    }
  }
  console.error("task did not finish within polling window");
  process.exitCode = 1;
}

export async function statusTask(client: DaemonClient, taskId?: string): Promise<void> {
  if (taskId) {
    printTask(await client.request("GET", `/v1/tasks/${taskId}`));
    return;
  }
  const tasks = await client.request("GET", "/v1/tasks");
  if (tasks.length === 0) {
    console.log("no tasks yet");
    return;
  }
  for (const t of tasks) printTask(t);
}

function printTask(t: any): void {
  console.log(`task ${t.id} · ${t.type} · ${t.status} · model=${t.modelId ?? "-"}`);
  if (t.resultSummary) {
    try {
      const summary = JSON.parse(t.resultSummary);
      if (summary.checks) {
        for (const c of summary.checks) console.log(`  check ${c.name}: ${c.ok ? "PASS" : "FAIL"}${c.output ? ` — ${c.output.slice(0, 120)}` : ""}`);
      } else {
        console.log(`  ${JSON.stringify(summary).slice(0, 300)}`);
      }
    } catch {
      console.log(`  ${t.resultSummary.slice(0, 300)}`);
    }
  }
}
