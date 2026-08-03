# ARCHITECTURE.md

# Agent Orchestrator Architecture

> 本文档记录系统架构设计。
>
> 在完成环境调查、Agent Runtime 调研、Model Provider 调研和需求澄清之前，不得认为本文档中的任何架构已经最终确定。

---

# 1. Architectural Objective

构建：

```text
Agent Runtime
×
Model
×
Task
×
Tool
×
Workspace
×
Validator
```

的统一调度体系。

---

# 2. Target Logical Architecture

```text
User
 │
 ▼
Task Gateway
 │
 ▼
Router
 │
 ▼
Planner
 │
 ▼
Task DAG
 │
 ▼
Scheduler
 │
 ├── Worker
 │     ├── Agent Runtime
 │     ├── Model
 │     ├── Tools
 │     └── Workspace
 │
 └── Worker
       ├── Agent Runtime
       ├── Model
       ├── Tools
       └── Workspace
 │
 ▼
Supervisor
 │
 ▼
Validator
 │
 ▼
Result
```

---

# 3. Core Components

## Task Gateway

负责：

```text
CLI
API
Future UI
```

接收用户任务。

---

## Router

负责：

```text
Classification
Capability Matching
Cost-aware Selection
Agent Selection
Model Selection
```

---

## Planner

负责：

```text
Task Decomposition
Dependency Analysis
DAG
```

---

## Scheduler

负责：

```text
Worker Allocation
Concurrency
Queue
Resource
Dependencies
```

---

## Worker

负责实际执行任务。

---

## Agent Adapter

统一接入：

```text
Claude Code
OpenCode
Codex
OpenClaw
Reasonix
Future Agents
```

---

## Model Adapter

统一接入：

```text
MIMO
DeepSeek
MiniMax
GLM
Free Models
Future Models
```

---

## Supervisor

负责：

```text
Retry
Timeout
Escalation
Recovery
Cancellation
```

---

## Validator

负责：

```text
Build
Test
Lint
E2E
Browser
Documentation
```

---

# 4. Important Architectural Constraints

## Constraint 1

Agent Runtime 和 Model 必须解耦。

## Constraint 2

新增 Agent 不应修改 Scheduler 核心代码。

## Constraint 3

新增 Model 不应修改 Scheduler 核心代码。

## Constraint 4

Router 不应该承担实际业务执行。

## Constraint 5

Supervisor 不应该承担业务逻辑。

## Constraint 6

并行 Worker 必须有 Workspace Isolation。

## Constraint 7

任务成功必须尽可能由 Validator 判断。

---

# 5. Open Architecture Questions

以下问题需要通过环境调查和用户决策确定：

```text
[ ] Primary Language
[ ] Runtime
[ ] CLI Framework
[ ] Persistence
[ ] Queue
[ ] Event Bus
[ ] Concurrency Model
[ ] Agent Adapter Protocol
[ ] Model Adapter Protocol
[ ] MCP Integration
[ ] Sandbox
[ ] Containerization
[ ] Git Worktree Strategy
[ ] State Machine
[ ] Observability
[ ] Logging
[ ] Metrics
[ ] Configuration Format
```

---

# 6. Architecture Decision Rule

任何架构决策必须考虑：

```text
Simplicity
Reliability
Extensibility
Debuggability
Performance
Cost
Security
```

避免仅仅因为某技术“先进”而采用。

---

# 7. Architecture Evolution

架构应该允许：

```text
MVP
 ↓
Local Single Machine
 ↓
Parallel Workers
 ↓
Advanced Routing
 ↓
Advanced Metrics
 ↓
Optional Distributed Execution
```

不要为了未来可能出现的需求过早实现分布式系统。

