import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface OutputEvent {
  type: string;
  ts: number;
  [key: string]: unknown;
}

/** 读取任务原始事件流（output.jsonl），支持 after 增量读取 */
export function readOutputEvents(stateDir: string, taskId: string, after = 0): { total: number; events: OutputEvent[] } {
  const file = join(stateDir, "runs", taskId, "output.jsonl");
  if (!existsSync(file)) return { total: 0, events: [] };
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const events = lines
    .slice(after)
    .map((line) => {
      try {
        return JSON.parse(line) as OutputEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is OutputEvent => e !== null);
  return { total: lines.length, events };
}
