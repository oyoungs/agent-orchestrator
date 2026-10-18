// 任务进度/结果的可读描述与共享输出工具（chat / run 共用）
// 纯函数部分不依赖终端，可直接单测；ProgressReporter 负责终端渲染。

import { Spinner } from "./spinner.ts";
import type { Task, TaskStatus } from "../types.ts";

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "succeeded",
  "failed",
  "validation_failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

const FAST_POLL_MS = 250;
const SLOW_POLL_MS = 1_000;
/** 前 10 秒高频轮询，避免快速状态迁移被粗间隔跳过 */
const FAST_POLL_WINDOW = 40;

export function pollDelay(iteration: number): number {
  return iteration < FAST_POLL_WINDOW ? FAST_POLL_MS : SLOW_POLL_MS;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest}s`;
}

export function elapsedMs(task: Pick<Task, "startedAt" | "finishedAt">, now = Date.now()): number | undefined {
  if (task.startedAt === null || task.startedAt === undefined) return undefined;
  const end = task.finishedAt ?? now;
  return Math.max(0, end - task.startedAt);
}

export function routingModel(task: Pick<Task, "routingInfo" | "modelId">): string | undefined {
  const info = task.routingInfo ? parseRoutingInfo(task.routingInfo) : null;
  if (info?.model) return info.model;
  return task.modelId ?? undefined;
}

export function parseRoutingInfo(raw: unknown): { model?: string; source?: string } | null {
  try {
    return JSON.parse(String(raw)) as { model?: string; source?: string };
  } catch {
    return null;
  }
}

export function routingSourceLabel(source?: string): string {
  if (source === "free-model") return "免费模型分析";
  if (source === "explicit") return "指定模型";
  return "规则路由";
}

export interface TaskProgressLine {
  /** 阶段标识：key 变化表示进入新阶段，需要重新播报 */
  key: string;
  text: string;
}

/** 非终态任务 → 一行可读进度；终态返回 null（由 summarizeTaskResult 处理） */
export function describeTaskProgress(task: Task, now = Date.now()): TaskProgressLine | null {
  if (TERMINAL_STATUSES.has(task.status)) return null;
  const model = routingModel(task);
  const elapsed = elapsedMs(task, now);
  switch (task.status) {
    case "created":
      return { key: "created", text: "已创建，等待调度" };
    case "analyzing":
      return { key: "analyzing", text: "分析中…（免费模型路由）" };
    case "queued":
      return { key: "queued", text: `排队中…（等待执行）${model ? ` · 模型 ${model}` : ""}` };
    case "running":
      return {
        key: "running",
        text: `模型 ${model ?? "…"} 正在思考${elapsed !== undefined ? ` · 已运行 ${formatDuration(elapsed)}` : ""}`,
      };
    case "validating":
      return { key: "validating", text: `验证中…${elapsed !== undefined ? ` · 已运行 ${formatDuration(elapsed)}` : ""}` };
    case "retrying":
      return { key: "retrying", text: "重试中…" };
    default:
      return null;
  }
}

export interface ValidationCheckView {
  name: string;
  ok: boolean;
  output?: string;
}

export interface TaskResultView {
  heading: string;
  status: TaskStatus;
  elapsed?: number;
  result?: string;
  checks: ValidationCheckView[];
  error?: string;
}

/** 终态任务 → 标题 + 结果 + 验证明细 + 错误说明（错误不再静默） */
export function summarizeTaskResult(task: Task): TaskResultView {
  const elapsed = elapsedMs(task);
  const model = task.modelId ? ` · model=${task.modelId}` : "";
  const time = elapsed !== undefined ? ` · 用时 ${formatDuration(elapsed)}` : "";
  const view: TaskResultView = {
    heading: `任务 ${task.id.slice(0, 8)} · ${task.type} · ${task.status}${model}${time}`,
    status: task.status,
    elapsed,
    checks: [],
  };
  if (task.resultSummary) {
    try {
      const summary = JSON.parse(task.resultSummary) as {
        agentResult?: string | null;
        validation?: { checks?: Array<{ name: string; ok: boolean; output?: string }> };
        checks?: Array<{ name: string; ok: boolean; output?: string }>;
        errorClass?: string;
        error?: string;
      };
      if (typeof summary.agentResult === "string") view.result = summary.agentResult;
      const checks = summary.validation?.checks ?? summary.checks ?? [];
      view.checks = checks.map((c) => ({ name: c.name, ok: c.ok, output: c.output }));
      if (summary.errorClass) {
        view.error = `${summary.errorClass}${summary.error ? ` — ${String(summary.error).slice(0, 300)}` : ""}`;
      }
    } catch {
      view.error = String(task.resultSummary).slice(0, 300);
    }
  }
  if (!view.error) {
    if (view.status === "cancelled") view.error = "任务已取消";
    else if (view.status === "timed_out") view.error = "任务超时";
    else if (view.status === "interrupted") view.error = "任务中断（daemon 重启）";
  }
  return view;
}

/**
 * 终端进度播报器：
 * - key 变化 → 立即播报（TTY 复用 spinner，非 TTY 打印单行）
 * - running/validating 阶段按 2s（TTY）/ 5s（非 TTY）心跳刷新耗时
 * - mute 用于正文流式输出开始后停止打扰
 */
export class ProgressReporter {
  private readonly spinner = new Spinner();
  private readonly tty = Boolean(process.stdout.isTTY);
  private lastKey = "";
  private lastPrintedAt = 0;
  private muted = false;

  report(line: TaskProgressLine, now = Date.now()): void {
    if (this.muted) return;
    const changed = line.key !== this.lastKey;
    const heartbeat =
      !changed &&
      (line.key === "running" || line.key === "validating") &&
      now - this.lastPrintedAt >= (this.tty ? 2_000 : 5_000);
    if (!changed && !heartbeat) return;
    this.lastKey = line.key;
    this.lastPrintedAt = now;
    if (this.tty) {
      if (this.spinner.active) this.spinner.setMessage(line.text);
      else this.spinner.start(line.text);
    } else {
      console.log(`· ${line.text}`);
    }
  }

  /** 打印过额外行（如路由信息）后，重置阶段以便下一轮重新播报 */
  reset(): void {
    this.lastKey = "";
  }

  mute(): void {
    this.muted = true;
  }

  stop(): void {
    this.spinner.stop();
  }
}
