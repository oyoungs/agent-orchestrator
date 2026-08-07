# Agent Orchestrator

A local-first Multi-Agent / Multi-Model Orchestration Framework.

## Status

Phase 0 (Discovery) 已完成 · 架构已确认（2026-08-03）

下一步：Phase 2 MVP

模型注册表由用户运行时管理（初始为空，不内置任何模型配置，2026-08-05 确认）

---

## Vision

统一协调：

```text
Agent Runtime
+
LLM
+
Tools
+
Workspace
+
Validator
```

最终实现：

```text
User Task
    ↓
Router
    ↓
Planner
    ↓
Scheduler
    ↓
Parallel Workers
    ↓
Agent Runtime
    ↓
Model
    ↓
Validation
    ↓
Supervisor
    ↓
Result
```

---

## Initial Agent Runtimes

```text
Claude Code
OpenCode
Codex
OpenClaw
Reasonix
```

---

## Initial Models (Research Baseline)

```text
MIMO V2.5 Pro
DeepSeek
MiniMax
GLM
OpenCode Free Models
```

以上仅为环境调查基线，**不作为内置配置**。模型注册表初始为空，
daemon 运行后通过 `agent model add` 自行添加自己购买的模型。

---

## Core Principles

### Agent / Model Separation

Agent Runtime 和 Model 独立。

### Free First

满足能力要求时优先使用低成本模型。

### Parallel First

无依赖任务尽可能并行。

### Validation First

通过客观验证判断任务是否成功。

### Workspace Isolation

并行 Coding Worker 使用隔离 Workspace。

### Failure Recovery

失败可以：

```text
Retry
Escalate
Switch Agent
Switch Model
Split Task
Ask User
```

---

## Current Phase

See:

```text
ROADMAP.md
```

## Tech Stack (Confirmed)

```text
TypeScript + Node.js + pnpm
SQLite + 进程内队列
TOML 配置
Agent Adapter: ACP-first + Claude/Codex 进程适配器
守护进程: 本地 daemon 承载存储 / 队列 / 管理 API
模型注册表: 用户运行时管理（CLI / WebUI），初始为空
```

## 快速开始（MVP）

```bash
pnpm install

# 1. 启动后台守护进程
node src/cli/index.ts daemon start

# 2. 添加自己购买的模型（初始注册表为空）
node src/cli/index.ts model add \
  --provider opencode --model-id deepseek-v4-flash-free \
  --wire-api openai-compatible --channel runtime --billing free

# 3. 提交任务
node src/cli/index.ts run "Reply with exactly one word: PONG"

# 3.1 交互模式（推荐）：免费模型分析路由 + 实时思考状态 + 会话续接
node src/cli/index.ts chat
node src/cli/index.ts chat --resume <session-id 或 task-id>   # 恢复历史会话/项目
# 首次输入自动创建会话/项目，之后每个任务自动追加到该会话的任务队列
# 每轮任务的输入+输出自动累积为会话上下文，下一轮自动携带（/context 查看）
# chat 中模型输出实时渲染 Markdown（标题/加粗/列表/代码块/表格等）
# chat 内可用 /help /history /sessions /resume <id> /tasks /models /model <id> /quit

# 4. 查看状态（含执行过程回放）/ 移除模型 / 停止
node src/cli/index.ts status <task-id>
node src/cli/index.ts model remove <model-id>
node src/cli/index.ts daemon stop
```

开发验证：`pnpm typecheck` / `pnpm test`。

## 一键部署

```bash
bash scripts/deploy.sh install      # 安装：依赖 + CLI 入口（agent）+ PATH symlink
bash scripts/deploy.sh upgrade      # 升级：拉取最新代码 + 重建 + 重启 daemon
bash scripts/deploy.sh uninstall    # 卸载：停止 daemon + 移除入口（数据保留）
bash scripts/deploy.sh uninstall --purge   # 卸载并删除数据（任务/会话/模型注册表）
bash scripts/deploy.sh status       # 查看安装状态
```

安装后 `agent` 命令可用（若提示 PATH 未包含目标目录，按提示导出后重开终端）。

> 工作目录：任务在**执行 agent 命令的当前目录**下工作（副本隔离），
> 与安装路径 / 项目源码位置无关。

---

## Architecture

See:

```text
ARCHITECTURE.md
```

---

## Specification

See:

```text
SPEC.md
```

---

## Development Rules

See:

```text
AGENTS.md
DEVELOPMENT.md
```

---

## Security

See:

```text
SECURITY.md
```

---

## Testing

See:

```text
TESTING.md
```
