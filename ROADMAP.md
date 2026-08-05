# ROADMAP.md

# Agent Orchestrator Roadmap

## Phase 0 — Discovery

目标：

```text
了解环境
了解 Agent
了解 Model
澄清需求
```

任务：

* [x] Inspect OS
* [x] Inspect Git
* [x] Inspect installed runtimes
* [x] Inspect Agent CLIs
* [x] Inspect Model APIs
* [x] Identify constraints
* [x] Ask user unresolved questions

完成于 2026-08-03。关键结论：

```text
5/5 Agent Runtime 可用（claude 2.1.220 / opencode 1.17.4 / codex 0.146.0-alpha.9.2 /
                         openclaw 2026.6.1 / reasonix 0.43.0）
全部云模型 API 可达；免费模型梯队已验证
MIMO token-plan key 失效（401），待用户刷新
需求澄清完成 → DECISIONS.md ADR-0001..0015
```

禁止大规模实现。

---

# Phase 1 — Architecture

目标：

建立：

```text
Task
Agent
Model
Worker
Router
Planner
Scheduler
Validator
```

之间的正式架构。

输出：

```text
Architecture
Data Model
Interfaces
Task Lifecycle
Worker Lifecycle
Failure Model
```

已完成 2026-08-03：见 ARCHITECTURE.md（组件、数据模型、状态机、适配接口、安全、可观测性）。

---

# Phase 2 — MVP

最小链路：

```text
CLI
 ↓
Task
 ↓
Router
 ↓
Agent Adapter
 ↓
Model
 ↓
Worker
 ↓
Result
```

暂时不追求复杂并行。

基于已确认决策的 MVP 技术栈：

```text
TypeScript + Node.js（pnpm）
SQLite（better-sqlite3）+ 进程内队列
守护进程（daemon）：存储 / 队列 / Model Registry / Management API
CLI：agent run / agent status + agent model add / list / update / remove / disable（commander）
交互 chat TUI：免费模型分析路由 / 模型思考状态 / 会话续接（/history /model /tasks）
Agent Adapter：ACP-first（opencode / openclaw / reasonix）+ Claude / Codex 进程适配器
安全：Runtime 原生权限 + 高风险动作人工确认
可观测：JSONL 日志 + usage_records 落库
```

验收：`agent run "修复这个项目的测试"` 能完整走通
`CLI → Task → Router → Agent Adapter → Model → Worker → Result` 并产出
`Build / Test / Lint` 验证报告。

验收（模型管理）：daemon 启动后
`agent model add <qwen>` → `agent model list` → `agent run` 使用该模型；
`agent model remove` 可移除失效模型。初始注册表为空。

验收（交互）：`agent chat` 中每次输入先显示
「免费模型分析中 → 已选择模型 X → 模型 X 正在思考 → 流式结果」，
继续输入自动追加为同一会话/项目（任务队列），`/history` 可回看；
首次输入自动创建 session，`/resume <session-id>` 或 `--resume` 可恢复历史会话。

---

# Phase 3 — Registry

实现用户管理的 Model Registry 增强：

```text
Agent Registry
Model Registry（用户管理，运行时增删改）
Capability Registry
连接探测（认证 / 可达性）
状态标记（active / disabled / error）
计费与能力校验
变更审计（model_change_log）
```

支持动态发现和配置。

---

# Phase 4 — DAG

实现：

```text
Task Decomposition
Dependency
DAG
```

---

# Phase 5 — Parallel Workers

实现：

```text
Scheduler
Worker Pool
Concurrency
Workspace Isolation
```

---

# Phase 6 — Supervisor

实现：

```text
Retry
Timeout
Failure Detection
Escalation
Recovery
Cancellation
```

---

# Phase 7 — Validation

实现：

```text
Build
Test
Lint
Integration
E2E
Task-specific Validation
```

---

# Phase 8 — Cost-aware Routing

实现：

```text
Free-first
Cost Tracking
Model Ranking
Model Escalation
```

---

# Phase 9 — Metrics

记录：

```text
Cost
Tokens
Latency
Success Rate
Failure Rate
Model Performance
Agent Performance
```

---

# Phase 10 — Adaptive Routing

根据历史数据：

```text
Task Type
+
Model
+
Agent
+
Result
```

学习：

```text
Best Model
Best Agent
Best Strategy
```

---

# Phase 11 — Advanced UX

可能增加：

```text
Web UI（管理后台 + 任务面板）
REST API
MCP
SDK
```

是否实现需要重新评估。

---

# Phase 12 — Optional Distributed Architecture

仅在真实需求出现后考虑：

```text
Remote Workers
Distributed Scheduler
Multi-machine
Cluster
```

不要提前实现。
