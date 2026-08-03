# Agent Orchestrator

A local-first Multi-Agent / Multi-Model Orchestration Framework.

## Status

Phase 0 (Discovery) 已完成 · 架构已确认（2026-08-03）

下一步：Phase 2 MVP

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

## Initial Models

```text
MIMO V2.5 Pro
DeepSeek
MiniMax
GLM
OpenCode Free Models
```

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
```

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
