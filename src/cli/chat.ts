import { createInterface } from "node:readline";
import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";
import { MarkdownStream, renderMarkdown } from "./markdown.ts";
import { Spinner } from "./spinner.ts";

const TERMINAL = new Set(["succeeded", "failed", "validation_failed", "cancelled", "timed_out"]);

export interface ChatOptions {
  resumeTaskId?: string;
}

export function formatContextSize(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}B`;
}

interface ResolvedSession {
  sessionId: string;
  session: { id: string; title: string | null; taskCount?: number };
  tasks: any[];
}

export async function chat(client: DaemonClient, opts: ChatOptions = {}): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  rl.setPrompt("你> ");

  let inputClosed = false;
  const lines: string[] = [];
  const waiters: Array<(v: string | null) => void> = [];
  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  rl.on("close", () => {
    inputClosed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  });
  rl.on("SIGINT", () => {
    console.log("\nbye");
    rl.close();
  });
  const nextInput = (): Promise<string | null> => {
    if (lines.length > 0) return Promise.resolve(lines.shift() as string);
    if (inputClosed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };

  let activeSessionId: string | undefined;
  let lastTaskId: string | undefined;
  let preferredModelId: string | undefined;
  let contextLimit = 12_000;
  try {
    const meta = await client.request("GET", "/v1/meta");
    contextLimit = Number(meta.sessionContextChars) || contextLimit;
  } catch {
    // 保持默认
  }
  const refreshPrompt = async (): Promise<void> => {
    let used = 0;
    if (activeSessionId) {
      try {
        const res = await client.request("GET", `/v1/sessions/${activeSessionId}`);
        used = String(res.session.context ?? "").length;
      } catch {
        // 会话可能刚被删除
      }
    }
    rl.setPrompt(`你(${formatContextSize(used)}/${formatContextSize(contextLimit)})> `);
  };

  console.log("Agent Orchestrator 交互模式 — 输入任务描述，Ctrl+C 或 /quit 退出");
  if (opts.resumeTaskId) {
    const resolved = await resolveSession(client, opts.resumeTaskId);
    if (resolved) {
      activeSessionId = resolved.sessionId;
      lastTaskId = resolved.tasks.at(-1)?.id;
      printSessionBanner(resolved);
    } else {
      console.log(`无法恢复 ${opts.resumeTaskId}（session 或 task 不存在）`);
    }
  } else {
    console.log("尚未创建会话/项目——第一条消息将自动创建；/help 查看命令");
  }

  while (true) {
    await refreshPrompt();
    if (process.stdin.isTTY && !inputClosed) rl.prompt();
    const line = await nextInput();
    if (line === null) break;
    const input = line.trim();
    if (!input) continue;
    if (input.startsWith("/")) {
      if (input === "/quit" || input === "/exit") {
        console.log("bye");
        break;
      }
      await handleCommand(
        client,
        input,
        () => activeSessionId,
        (id) => (activeSessionId = id),
        (id) => (lastTaskId = id),
        (id) => (preferredModelId = id),
      );
      continue;
    }

    const body: Record<string, unknown> = { prompt: input };
    if (activeSessionId) body.sessionId = activeSessionId;
    if (lastTaskId) body.parentId = lastTaskId;
    if (preferredModelId) body.modelId = preferredModelId;
    const task = await client.request("POST", "/v1/tasks", body);
    if (!activeSessionId) {
      activeSessionId = task.sessionKey;
      console.log(`📁 已创建新会话/项目：${activeSessionId}（/resume 可恢复）`);
    }
    lastTaskId = await runTurn(client, task.id);
    console.log(`（输入下一条消息继续追加到会话 ${activeSessionId?.slice(0, 8)}，/help 查看命令）`);
  }
  if (!inputClosed) rl.close();
}

/** 解析 session id 或 task id → 所属会话 */
async function resolveSession(client: DaemonClient, id: string): Promise<ResolvedSession | null> {
  try {
    const res = await client.request("GET", `/v1/sessions/${id}`);
    return { sessionId: res.session.id, session: res.session, tasks: res.tasks };
  } catch {
    try {
      const task = await client.request("GET", `/v1/tasks/${id}`);
      const res = await client.request("GET", `/v1/sessions/${task.sessionKey}`);
      return { sessionId: res.session.id, session: res.session, tasks: res.tasks };
    } catch {
      return null;
    }
  }
}

function printSessionBanner(resolved: ResolvedSession): void {
  console.log(`📁 会话/项目 ${resolved.sessionId}`);
  console.log(`   标题：${resolved.session.title ?? "-"} · 任务数：${resolved.tasks.length}`);
  for (const t of resolved.tasks) {
    console.log(`   [${t.type} · ${t.status}] ${String(t.prompt).slice(0, 80)}`);
  }
}

async function runTurn(client: DaemonClient, taskId: string): Promise<string> {
  console.log(`· 任务 ${taskId.slice(0, 8)} 已提交`);
  const spinner = new Spinner();
  let mdStream: MarkdownStream | null = null;
  let printed = 0;
  let analysisShown = false;
  let routingShown = false;
  let thinkingShown = false;
  let sawText = false;
  let routingModel: string | undefined;

  for (let i = 0; i < 600; i += 1) {
    const current = await client.request("GET", `/v1/tasks/${taskId}`);
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
    const out = await client.request("GET", `/v1/tasks/${taskId}/output?after=${printed}`);
    if (out.events?.length) {
      for (const ev of out.events) {
        if (ev.type === "thinking" && !sawText && !thinkingShown) spinner.start(`模型 ${ev.model} 正在思考`);
        if (ev.type === "text" && ev.text) {
          if (!sawText) spinner.stop();
          sawText = true;
          if (process.stdout.isTTY) {
            mdStream ??= new MarkdownStream();
            mdStream.append(String(ev.text));
          } else {
            console.log(String(ev.text));
          }
        } else if (ev.type === "tool") {
          spinner.stop();
          const mark = ev.status === "failed" ? "✗" : ev.status === "denied" ? "⛔" : "✓";
          const input = ev.input !== undefined ? ` ${JSON.stringify(ev.input).slice(0, 120)}` : "";
          console.log(`  [工具] ${mark} ${String(ev.tool)}${input}`);
          if (ev.output) {
            const out = String(ev.output).trim().slice(0, 200);
            if (out) console.log(`         ${out.replace(/\n/g, "\n         ")}`);
          }
        } else if (ev.type === "error") {
          spinner.stop();
          console.error(`  [错误] ${String(ev.message)}`);
        }
      }
      printed = out.total ?? printed;
    }
    if (TERMINAL.has(current.status)) {
      spinner.stop();
      mdStream?.finish();
      printChatResult(current);
      return current.id;
    }
    await sleep(800);
  }
  spinner.stop();
  console.error("任务未在轮询窗口内完成");
  return taskId;
}

async function handleCommand(
  client: DaemonClient,
  input: string,
  getSession: () => string | undefined,
  setSession: (id: string | undefined) => void,
  setLast: (id: string | undefined) => void,
  setPreferredModel: (id: string | undefined) => void,
): Promise<void> {
  const [cmd, arg] = input.split(/\s+/, 2);
  switch (cmd) {
    case "/help":
      console.log(`命令列表：
  /help            帮助
  /history         当前会话任务队列
  /context         查看当前会话自动维护的上下文
  /sessions        列出历史会话/项目
  /resume <id>     恢复历史会话/项目（session 或 task id）
  /tasks           最近任务列表
  /models          已注册模型
  /model <id>      指定下一个任务使用的模型（/models 查看 id）
  /quit, /exit     退出`);
      break;
    case "/resume": {
      if (!arg) {
        console.log("用法：/resume <session-id 或 task-id>（/sessions 或 /tasks 查看）");
        break;
      }
      const resolved = await resolveSession(client, arg);
      if (!resolved) {
        console.log(`无法恢复 ${arg}（session 或 task 不存在）`);
        break;
      }
      setSession(resolved.sessionId);
      setLast(resolved.tasks.at(-1)?.id);
      printSessionBanner(resolved);
      break;
    }
    case "/history": {
      const sessionId = getSession();
      if (!sessionId) {
        console.log("当前还没有会话");
        break;
      }
      const res = await client.request("GET", `/v1/sessions/${sessionId}`);
      if (res.tasks.length === 0) {
        console.log("会话中还没有任务");
        break;
      }
      for (const t of res.tasks) {
        const result = agentResultOf(t);
        console.log(`  [${t.type} · ${t.status}] ${String(t.prompt).slice(0, 100)}${result ? `\n    → ${result.slice(0, 150)}` : ""}`);
      }
      break;
    }
    case "/context": {
      const sessionId = getSession();
      if (!sessionId) {
        console.log("当前还没有会话");
        break;
      }
      const res = await client.request("GET", `/v1/sessions/${sessionId}`);
      const ctx = String(res.session.context ?? "");
      if (!ctx) {
        console.log("当前会话还没有上下文（完成一轮任务后自动累积）");
        break;
      }
      console.log(`当前会话上下文（${ctx.length} 字符）：`);
      console.log(ctx);
      break;
    }
    case "/sessions": {
      const sessions = (await client.request("GET", "/v1/sessions")) as any[];
      if (sessions.length === 0) {
        console.log("暂无会话/项目");
        break;
      }
      for (const s of sessions) {
        console.log(`  ${s.id} · ${String(s.title ?? "-").slice(0, 40)} · ${s.taskCount ?? 0} 个任务`);
      }
      break;
    }
    case "/tasks": {
      const tasks = (await client.request("GET", "/v1/tasks")) as any[];
      if (tasks.length === 0) {
        console.log("暂无任务");
        break;
      }
      for (const t of tasks.slice(0, 10)) {
        console.log(`  ${t.id} · ${t.type} · ${t.status} · ${String(t.prompt).slice(0, 60)}`);
      }
      break;
    }
    case "/models": {
      const models = (await client.request("GET", "/v1/models")) as any[];
      if (models.length === 0) {
        console.log("注册表为空：agent model add 添加模型");
        break;
      }
      for (const m of models) console.log(`  ${m.id} · ${m.name} · ${m.status} · ${m.billing.type}`);
      break;
    }
    case "/model": {
      if (!arg) {
        console.log("用法：/model <模型 id>（/models 查看）");
        break;
      }
      const model = await client.request("GET", `/v1/models/${arg}`);
      setPreferredModel(model.id);
      console.log(`后续任务将使用模型：${model.name}`);
      break;
    }
    default:
      console.log(`未知命令 ${cmd}；/help 查看帮助`);
  }
}

function printChatResult(t: any): void {
  const result = agentResultOf(t);
  if (result) {
    if (process.stdout.isTTY) {
      console.log("结果：");
      console.log(renderMarkdown(result));
    } else {
      console.log(`结果：${result.slice(0, 800)}`);
    }
  }
  if (t.resultSummary) {
    try {
      const summary = JSON.parse(t.resultSummary);
      const validation = summary.validation ?? summary;
      if (validation.checks?.length) {
        const failed = validation.checks.filter((c: any) => !c.ok);
        if (failed.length === 0) console.log("验证：全部通过");
        else for (const c of failed) console.log(`验证失败：${c.name}${c.output ? ` — ${String(c.output).slice(0, 120)}` : ""}`);
      }
    } catch {
      // 忽略
    }
  }
}

function agentResultOf(t: any): string | undefined {
  if (!t.resultSummary) return undefined;
  try {
    const parsed = JSON.parse(t.resultSummary) as { agentResult?: string };
    return parsed.agentResult ?? undefined;
  } catch {
    return undefined;
  }
}
