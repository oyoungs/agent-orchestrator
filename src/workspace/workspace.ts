import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", ".agent-orchestrator", "dist", "coverage"]);

/**
 * Workspace 分配。
 *
 * 注意：目标目录必须在项目根之外——cpSync 拒绝复制目录到自身的子目录。
 * 默认使用系统临时目录（`<tmpdir>/agent-orchestrator-ws/<taskId>`）。
 */
export class WorkspaceManager {
  private readonly projectRoot: string;
  private readonly stateDir: string;
  private readonly workspaceBase: string;

  constructor(projectRoot: string, stateDir: string, workspaceBase?: string) {
    this.projectRoot = projectRoot;
    this.stateDir = stateDir;
    this.workspaceBase = workspaceBase ?? join(tmpdir(), "agent-orchestrator-ws");
  }

  allocate(taskId: string): string {
    const ws = join(this.workspaceBase, taskId);
    mkdirSync(ws, { recursive: true });
    if (!existsSync(this.projectRoot)) return ws;
    cpSync(this.projectRoot, ws, {
      recursive: true,
      filter: (src) => !SKIP_DIRS.has(basename(src)),
    });
    return ws;
  }

  release(taskId: string): void {
    rmSync(join(this.workspaceBase, taskId), { recursive: true, force: true });
  }
}
