#!/usr/bin/env node
import { Command, Option } from "commander";
import { createClient, CliError } from "./client.ts";
import { startDaemon, stopDaemon, daemonStatus } from "./daemon.ts";
import { addModel, formatModel, listModels, removeModel, updateModel, type ModelAddOptions } from "./model.ts";
import { runTask, statusTask } from "./run.ts";

const program = new Command();
program
  .name("agent")
  .description("Agent Orchestrator CLI（daemon 客户端）")
  .version("0.1.0");

function guard<T extends unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof CliError) {
        console.error(`error: ${err.message}`);
        process.exitCode = 1;
      } else {
        throw err;
      }
    }
  };
}

program
  .command("daemon")
  .argument("<action>", "start | stop | status")
  .action(
    guard(async (action: string) => {
      if (action === "start") await startDaemon();
      else if (action === "stop") await stopDaemon();
      else if (action === "status") await daemonStatus();
      else throw new CliError(`unknown daemon action: ${action}`, "INVALID_ARG");
    }),
  );

const modelCmd = program.command("model").description("管理模型注册表（初始为空，用户自购模型）");

modelCmd
  .command("add")
  .requiredOption("--provider <provider>", "模型提供商")
  .requiredOption("--model-id <modelId>", "模型 ID")
  .requiredOption("--wire-api <wireApi>", "openai-compatible | anthropic | responses")
  .option("--name <name>", "显示名称（默认 provider/model-id）")
  .option("--channel <channel>", "direct | runtime（默认 direct）", "direct")
  .option("--base-url <url>", "API 端点（direct 必填）")
  .option("--auth-env <env>", "凭据环境变量名（不传值，只存引用）")
  .addOption(new Option("--billing <type>", "计费方式").choices(["free", "pay-as-you-go", "subscription", "token-plan", "local"]).default("pay-as-you-go"))
  .option("--price-input <n>", "输入单价（USD / 1M tokens）", parseFloat)
  .option("--price-output <n>", "输出单价（USD / 1M tokens）", parseFloat)
  .option("--price-cache-read <n>", "缓存读单价", parseFloat)
  .option("--context-window <n>", "上下文窗口", parseInt)
  .option("--max-output <n>", "最大输出 tokens", parseInt)
  .option("--tool-calling", "支持工具调用", false)
  .option("--streaming", "支持流式")
  .option("--reasoning", "支持推理", false)
  .action(
    guard(async (opts: Record<string, unknown>) => {
      const input: ModelAddOptions = {
        provider: String(opts.provider),
        modelId: String(opts.modelId),
        wireApi: String(opts.wireApi),
        channel: String(opts.channel ?? "direct"),
        name: opts.name !== undefined ? String(opts.name) : undefined,
        baseUrl: opts.baseUrl !== undefined ? String(opts.baseUrl) : undefined,
        authEnv: opts.authEnv !== undefined ? String(opts.authEnv) : undefined,
        billing: String(opts.billing ?? "pay-as-you-go"),
        priceInput: opts.priceInput as number | undefined,
        priceOutput: opts.priceOutput as number | undefined,
        priceCacheRead: opts.priceCacheRead as number | undefined,
        contextWindow: opts.contextWindow as number | undefined,
        maxOutput: opts.maxOutput as number | undefined,
        toolCalling: opts.toolCalling === true,
        streaming: opts.streaming !== false,
        reasoning: opts.reasoning === true,
      };
      const model = await addModel(createClient(), input);
      console.log(`model added: ${formatModel(model)}`);
    }),
  );

modelCmd
  .command("list")
  .action(
    guard(async () => {
      const models = await listModels(createClient());
      if (models.length === 0) {
        console.log("no models registered (initial registry is empty)");
        return;
      }
      for (const m of models) console.log(formatModel(m));
    }),
  );

modelCmd
  .command("remove")
  .argument("<id>", "模型 id（agent model list 查看）")
  .action(
    guard(async (id: string) => {
      await removeModel(createClient(), id);
      console.log(`model removed: ${id}`);
    }),
  );

modelCmd
  .command("set-status")
  .argument("<id>", "模型 id")
  .argument("<status>", "active | disabled | error")
  .action(
    guard(async (id: string, status: string) => {
      await updateModel(createClient(), id, { status });
      console.log(`model ${id} → ${status}`);
    }),
  );

program
  .command("run")
  .argument("<prompt>", "任务描述")
  .action(
    guard(async (prompt: string) => {
      await runTask(createClient(), prompt);
    }),
  );

program
  .command("status")
  .argument("[taskId]", "任务 id（缺省列出最近任务）")
  .action(
    guard(async (taskId?: string) => {
      await statusTask(createClient(), taskId);
    }),
  );

await program.parseAsync(process.argv);
