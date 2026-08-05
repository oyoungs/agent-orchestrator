import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { TaskType } from "../types.ts";

export interface CheckResult {
  name: string;
  ok: boolean;
  exitCode: number | null;
  output: string;
}

export interface ValidationResult {
  ok: boolean;
  checks: CheckResult[];
}

interface PackageScripts {
  test?: string;
  build?: string;
  lint?: string;
}

export class Validator {
  async run(type: TaskType, cwd: string, timeoutMs = 120_000): Promise<ValidationResult> {
    const scripts = this.detectScripts(cwd);
    const checks: CheckResult[] = [];

    if (type === "test" || type === "fix" || type === "refactor") {
      checks.push(await this.check("test", scripts.test, cwd, timeoutMs, type === "test"));
    }
    if (type === "refactor") {
      checks.push(await this.check("build", scripts.build, cwd, timeoutMs, false));
      checks.push(await this.check("lint", scripts.lint, cwd, timeoutMs, false));
    }
    if (checks.length === 0) {
      checks.push({ name: "noop", ok: true, exitCode: null, output: "no validator matched task type" });
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  private detectScripts(cwd: string): PackageScripts {
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return {};
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: PackageScripts };
      return pkg.scripts ?? {};
    } catch {
      return {};
    }
  }

  private async check(
    name: string,
    script: string | undefined,
    cwd: string,
    timeoutMs: number,
    required: boolean,
  ): Promise<CheckResult> {
    if (!script) {
      return required
        ? { name, ok: false, exitCode: null, output: `no "${name}" script in package.json` }
        : { name, ok: true, exitCode: null, output: `no "${name}" script; skipped` };
    }
    const runner = existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm" : "npm";
    const args = runner === "pnpm" ? [name] : ["run", name];
    return this.runCommand(name, runner, args, cwd, timeoutMs);
  }

  private runCommand(
    name: string,
    cmd: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<CheckResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        output += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        output += d.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          name,
          ok: code === 0 && !timedOut,
          exitCode: code,
          output: timedOut ? `timed out after ${timeoutMs}ms` : output.slice(-2000),
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ name, ok: false, exitCode: null, output: err.message });
      });
    });
  }
}
