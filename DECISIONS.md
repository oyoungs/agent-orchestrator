# DECISIONS.md

# Architecture Decision Records

本文档记录重要架构决策。

原则：

> 任何影响系统长期结构的重要决策，都应该记录原因，而不仅仅记录结果。

---

## ADR-0001 Project Scope

### Status

Proposed

### Decision

构建本地 Multi-Agent / Multi-Model Orchestrator。

### Context

需要统一管理：

```text
Multiple Agent Runtime
Multiple Models
Task Routing
Parallel Execution
Validation
Cost Optimization
```

### Alternatives

```text
A. 手动管理 Agent
B. 单一 Agent
C. 自建 Orchestrator
```

### Current Direction

C

### Reason

需要统一协调多个 Agent Runtime 和模型。

---

## ADR-0002 Agent / Model Separation

### Status

Proposed

### Decision

Agent Runtime 和 Model 必须解耦。

### Reason

允许：

```text
OpenCode + DeepSeek
OpenCode + MIMO
Codex + DeepSeek
Claude Code + MIMO
```

等组合动态存在。

---

## ADR-0003 Free-first Routing

### Status

Proposed

### Decision

默认优先选择满足能力要求的最低成本模型。

### Reason

降低总体推理成本。

---

## ADR-0004 Parallel Execution

### Status

Proposed

### Decision

独立 Task 可以并行。

### Constraint

必须考虑：

```text
Dependency
Resource Conflict
Workspace Conflict
```

---

## ADR-0005 Workspace Isolation

### Status

Proposed

### Decision

优先研究 Git Worktree。

### Reason

避免多个 Coding Worker 同时修改同一 Workspace。

---

# Future ADRs

后续记录：

```text
ADR-xxxx Primary Language
ADR-xxxx Persistence
ADR-xxxx Queue
ADR-xxxx Event Bus
ADR-xxxx Agent Adapter
ADR-xxxx Model Adapter
ADR-xxxx Sandbox
ADR-xxxx MCP
ADR-xxxx Scheduler
ADR-xxxx State Machine
```

