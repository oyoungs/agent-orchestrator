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

支持**运行时注册用户自购模型**。初始注册表为空，系统不内置任何模型配置。

```text
Provider
Model ID
连接信息（base_url / wire protocol）
计费方式与单价
支持能力（Context / Tool Calling / Streaming / Reasoning / Modalities / Max Output）
认证引用（凭据不落库明文）
可用状态（active / disabled / error）
```

模型通过管理入口（守护进程运行后，CLI 或 WebUI）添加、更新、移除。

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

## FR-013 Model Management

支持通过管理入口（daemon 运行后）管理模型生命周期：

```text
添加模型        记录连接信息、计费方式、支持能力
查看 / 更新     修改价格、能力、连接、状态
移除模型        API 失效（如忘记续费）时允许删除
禁用 / 启用     临时下线，不影响注册记录
连接探测        可选，验证认证与可达性，失败标记 error
```

所有变更记录审计日志（谁 / 何时 / 改了什么）。

---

## FR-014 Daemon & Management Interface

项目后台守护进程（daemon）承载：

```text
SQLite 存储
任务队列
Model Registry
Management API
```

管理方式：

```text
CLI 工具（MVP）   agent model add / list / update / remove / disable
WebUI（后续）      管理后台，复用同一 API
```

初始项目不含任何模型配置，必须由用户添加后才能执行依赖模型的任务。

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

模型管理入口（守护进程运行后）：

```bash
agent model add qwen3 \
  --provider openai-compatible \
  --base-url https://api.example.com/v1 \
  --model-id qwen3-max \
  --billing pay-as-you-go \
  --price-input 0.5 --price-output 1.5

agent model list
agent model remove qwen3
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

---

# 10. MVP Scope (Confirmed 2026-08-03)

以下决策已与用户确认，记录于 DECISIONS.md ADR-0006..0015：

```text
实现栈        TypeScript + Node.js（pnpm）
持久化        SQLite + 进程内队列
任务范围      MVP 仅处理 coding 类任务（重构 / 测试 / 修复 / 审查）
CLI          agent run <task> 与 agent status
Workspace    git worktree（有 repo）/ 目录副本（无 repo）混合
安全边界      复用 Runtime 原生权限 + 高风险动作人工确认
Agent 接入    ACP 优先（opencode / openclaw / reasonix）+ Claude / Codex 进程适配器
模型接入      不内置任何模型配置；初始注册表为空，用户通过管理入口添加（ADR-0016）
模型管理      daemon 运行后通过 CLI / WebUI 添加、更新、移除模型（ADR-0017）
配置格式      TOML
```

## 10.1 实测基线（2026-08-03）

```text
5/5 Runtime 非交互链路可用（Claude Code / OpenCode / Codex / OpenClaw / Reasonix）
免费模型已验证：opencode/deepseek-v4-flash-free、opencode/mimo-v2.5-free
MIMO token-plan（Claude Code 接入）当前 401 Invalid API Key，需刷新后重新验证
本地 oMLX / Ollama 服务未运行
```
