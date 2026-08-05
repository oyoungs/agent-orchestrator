import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AdapterFactory } from "../adapters/factory.ts";
import { loadConfig, PROJECT_ROOT, STATE_DIR } from "../config/config.ts";
import { TaskService } from "../gateway/taskService.ts";
import type { Logger } from "../observability/logger.ts";
import { createLogger } from "../observability/logger.ts";
import { ModelRegistry } from "../registry/modelRegistry.ts";
import { Router } from "../router/router.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { loadOrCreateToken } from "../security/token.ts";
import { openDb, closeDb } from "../store/db.ts";
import { SessionRepo } from "../store/sessionRepo.ts";
import { TaskRepo } from "../store/taskRepo.ts";
import { Validator } from "../validator/validator.ts";
import { executeTask, type WorkerDeps } from "../worker/worker.ts";
import { WorkspaceManager } from "../workspace/workspace.ts";
import { startServer } from "./server.ts";
import { clearState, writeState } from "./state.ts";

const config = loadConfig();
const stateDir = STATE_DIR;
const db = openDb(join(stateDir, "daemon.db"));
const { token } = loadOrCreateToken(stateDir);
const logger: Logger = createLogger({ stateDir });

const taskRepo = new TaskRepo(db);
const sessionRepo = new SessionRepo(db);
const registry = new ModelRegistry(db);
const router = new Router();
const workspace = new WorkspaceManager(PROJECT_ROOT, stateDir);
const adapters = new AdapterFactory(config.agents);
const validator = new Validator();

const deps: WorkerDeps = { taskRepo, registry, sessions: sessionRepo, workspace, adapters, validator, logger, config, stateDir };
const scheduler = new Scheduler(config.orchestrator.concurrency, (task) => executeTask(deps, task));
const taskService = new TaskService(taskRepo, router, registry, scheduler, sessionRepo);

// 崩溃恢复：启动时把悬挂任务标记为 interrupted（ADR-0017）
taskRepo.markInterrupted();

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("daemon.shutting_down", {});
  taskRepo.markInterrupted();
  clearState(stateDir);
  closeDb(db);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

const pidFile = join(stateDir, "daemon.pid");
writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

const { server, port } = await startServer(
  { registry, taskService, logger, stateDir, sessionContextChars: config.orchestrator.sessionContextChars, onShutdown: shutdown },
  { host: config.daemon.host, port: config.daemon.port, token },
);
writeState(stateDir, { port, tokenFile: join(stateDir, "daemon.token"), pid: process.pid });
logger.info("daemon.started", { port, pid: process.pid });
