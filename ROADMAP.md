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

* [ ] Inspect OS
* [ ] Inspect Git
* [ ] Inspect installed runtimes
* [ ] Inspect Agent CLIs
* [ ] Inspect Model APIs
* [ ] Identify constraints
* [ ] Ask user unresolved questions

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

---

# Phase 3 — Registry

实现：

```text
Agent Registry
Model Registry
Capability Registry
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
Web UI
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

