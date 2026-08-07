import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
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
  private readonly fallbackRoot: string;
  private readonly workspaceBase: string;

  constructor(fallbackRoot: string, workspaceBase?: string) {
    this.fallbackRoot = fallbackRoot;
    this.workspaceBase = workspaceBase ?? join(tmpdir(), "agent-orchestrator-ws");
  }

  /** 以任务目标目录为源复制 workspace；缺省回退到项目根 */
  allocate(taskId: string, targetDir?: string): string {
    const ws = join(this.workspaceBase, taskId);
    mkdirSync(ws, { recursive: true });
    const srcRaw = targetDir ?? this.fallbackRoot;
    let src = srcRaw;
    try {
      src = realpathSync(srcRaw);
    } catch {
      // 保留原路径（不存在时下方 existsSync 兜底）
    }
    if (!existsSync(src)) return ws;
    cpSync(src, ws, {
      recursive: true,
      filter: (src) => {
        if (SKIP_DIRS.has(basename(src))) return false;
        try {
          const st = lstatSync(src);
          // 跳过 socket / FIFO / 设备等特殊文件（cpSync 会因它们抛 "Unreachable code"）
          if (!st.isDirectory() && !st.isFile()) return false;
        } catch {
          return false;
        }
        return true;
      },
    });
    return ws;
  }

  release(taskId: string): void {
    rmSync(join(this.workspaceBase, taskId), { recursive: true, force: true });
  }
}
