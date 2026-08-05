import { createInterface } from "node:readline";
import type { DaemonClient } from "./client.ts";
import { sleep } from "./client.ts";
import { Spinner } from "./spinner.ts";

const TERMINAL = new Set(["succeeded", "failed", "validation_failed", "cancelled", "timed_out"]);

export interface ChatOptions {
  resumeTaskId?: string;
}

export async function chat(client: DaemonClient, opts: ChatOptions = {}): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });

  // 行缓冲：从创建起持续收集输入，避免异步处理期间丢失管道行
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

  let lastTaskId: string | undefined = opts.resumeTaskId;
  let preferredModelId: string | undefined;

  console.log("Agent Orchestrator 交互模式 — 输入任务描述，Ctrl+C 或 /quit 退出");
  if (lastTaskId) {
    try {
      const chain = (await client.request("GET", `/v1/tasks/${lastTaskId}/chain`)) as any[];
      console.log(`已恢复会话：共 ${chain.length} 轮历史`);
      for (const t of chain) {
        const result = agentResultOf(t);
        console.log(`  [${t.type}] ${String(t.prompt).slice(0, 80)}${result ? `\n    → ${result.slice(0, 120)}` : ""}`);
      }
      lastTaskId = chain[chain.length - 1]?.id ?? lastTaskId;
    } catch {
      console.log("无法恢复该会话（任务不存在）");
      lastTaskId = undefined;
    }
  } else {
    console.log("每条消息都会先经免费模型分析路由，再选择更合适的模型执行；/help 查看命令");
  }

  while (true) {
    if (process.stdin.isTTY && !inputClosed) process.stdout.write("你> ");
    const line = await nextInput();
    if (line === null) break;
    const input = line.trim();
    if (!input) continue;
    if (input.startsWith("/")) {
      if (input === "/quit" || input === "/exit") {
        console.log("bye");
        break;
      }
      await handleCommand(client, input, () => lastTaskId, (id) => (lastTaskId = id), (id) => (preferredModelId = id));
    } else {
      lastTaskId = await runTurn(client, input, lastTaskId, preferredModelId);
    }
  }
  if (!inputClosed) rl.close();
}

async function runTurn(
  client: DaemonClient,
  prompt: string,
  lastTaskId: string | undefined,
  preferredModelId: string | undefined,
): Promise<string> {
  const body: Record<string, unknown> = { prompt };
  if (lastTaskId) body.parentId = lastTaskId;
  if (preferredModelId) body.modelId = preferredModelId;
  const task = await client.request("POST", "/v1/tasks", body);
  console.log(`· 任务 ${task.id.slice(0, 8)} 已提交${task.status === "analyzing" ? "，免费模型分析中…" : ""}`);

  const spinner = new Spinner();
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
        if (ev.type === "thinking" && !sawText && !thinkingShown) spinner.start(`模型 ${ev.model} 正在思考`);
        if (ev.type === "text" && ev.text) {
          if (!sawText) spinner.stop();
          sawText = true;
          console.log(String(ev.text));
        } else if (ev.type === "tool") {
          spinner.stop();
          console.log(`  [工具] ${String(ev.tool)}`);
        } else if (ev.type === "error") {
          spinner.stop();
          console.error(`  [错误] ${String(ev.message)}`);
        }
      }
      printed = out.total ?? printed;
    }
    if (TERMINAL.has(current.status)) {
      spinner.stop();
      printChatResult(current);
      console.log("（输入下一条消息继续追加对话，/help 查看历史与管理命令）");
      return current.id;
    }
    await sleep(800);
  }
  spinner.stop();
  console.error("任务未在轮询窗口内完成");
  return task.id;
}

async function handleCommand(
  client: DaemonClient,
  input: string,
  getLast: () => string | undefined,
  setLast: (id: string) => void,
  setPreferredModel: (id: string | undefined) => void,
): Promise<void> {
  const [cmd, arg] = input.split(/\s+/, 2);
  switch (cmd) {
    case "/help":
      console.log(`命令列表：
  /help          帮助
  /history       当前会话历史（任务链）
  /tasks         最近任务列表
  /models        已注册模型
  /model <id>    指定下一个任务使用的模型（/models 查看 id）
  /quit, /exit   退出`);
      break;
    case "/history": {
      const last = getLast();
      if (!last) {
        console.log("当前还没有任务");
        break;
      }
      const chain = (await client.request("GET", `/v1/tasks/${last}/chain`)) as any[];
      for (const t of chain) {
        const result = agentResultOf(t);
        console.log(`  [${t.type} · ${t.status}] ${String(t.prompt).slice(0, 100)}${result ? `\n    → ${result.slice(0, 150)}` : ""}`);
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
  if (result) console.log(`结果：${result.slice(0, 800)}`);
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
