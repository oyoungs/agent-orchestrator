# SPEC.md

# Agent Orchestrator Specification

## 1. Project Goal

构建一个本地运行的 Multi-Agent / Multi-Model Orchestrator。

系统负责统一调度：

```text
User Task
Agent Runtime
LLM
Tools
Workspace
Validator
```

最终目标：

> 用户只描述任务，系统自动决定由哪些 Agent、哪些模型、以什么顺序、以何种并发方式完成任务。

---

# 2. Core Problem

当前存在多个独立 Agent Runtime：

```text
Claude Code
OpenCode
Codex
OpenClaw
Reasonix
```

同时存在多个模型：

```text
MIMO V2.5 Pro
DeepSeek
MiniMax
GLM
Free Models
```

用户需要解决：

```text
Agent Selection
Model Selection
Task Decomposition
Parallel Execution
Failure Recovery
Cost Optimization
Validation
```

---

# 3. Core Principle

核心抽象：

```text
Task
 ↓
Router
 ↓
Planner
 ↓
Scheduler
 ↓
Worker
 ↓
Agent Runtime
 ↓
Model
 ↓
Tools
 ↓
Validator
```

---

# 4. Functional Requirements

## FR-001 Agent Registry

支持注册：

```text
Agent Runtime
Provider
Version
Capabilities
CLI/API
Availability
```

---

## FR-002 Model Registry

支持注册：

```text
Provider
Model
Cost
Context
Capabilities
Latency
Reliability
Tool Calling
Streaming
```

---

## FR-003 Agent Adapter

允许不同 Agent Runtime 使用统一接口接入。

---

## FR-004 Model Adapter

允许不同模型 Provider 使用统一接口接入。

---

## FR-005 Task Router

根据任务自动判断：

```text
Task Type
Complexity
Capability
Agent
Model
Cost
```

---

## FR-006 Task Planner

复杂任务自动拆分成 DAG。

---

## FR-007 Parallel Execution

没有依赖和资源冲突的任务允许并行。

---

## FR-008 Worker

Worker 负责具体 Task 执行。

---

## FR-009 Supervisor

管理：

```text
Retry
Timeout
Failure
Escalation
Cancellation
Recovery
```

---

## FR-010 Validation

任务必须尽可能通过客观验证。

---

## FR-011 Cost Tracking

记录：

```text
Model
Token
Cost
Latency
Task
Agent
Success
Failure
Retry
```

---

## FR-012 Metrics

统计：

```text
Success Rate
Model Performance
Agent Performance
Cost
Latency
Failure Rate
```

---

# 5. Non-functional Requirements

系统必须：

```text
Modular
Extensible
Testable
Observable
Secure
Local-first
```

---

# 6. Initial UX

初期优先 CLI。

目标体验：

```bash
agent run "重构这个 C++ 项目并增加测试"
```

而不是要求用户指定：

```text
Agent
Model
Parallelism
Retry
```

---

# 7. Long-term UX

未来可以支持：

```text
CLI
Web UI
REST API
MCP
Programmatic SDK
```

但是否全部实现需要后续需求确认。

---

# 8. Success Criteria

最终系统能够：

```text
识别任务
↓
选择 Agent
↓
选择 Model
↓
拆分 Task
↓
并行执行
↓
隔离 Workspace
↓
自动验证
↓
失败恢复
↓
模型升级
↓
最终 Review
↓
输出结果
```

---

# 9. Out of Scope Initially

以下内容默认不进入第一版 MVP：

```text
Distributed Cluster
Multi-machine Scheduling
复杂 Web UI
复杂 Billing
企业级多租户
复杂权限中心
```

如果未来需要，单独进入 Roadmap。

