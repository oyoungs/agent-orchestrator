# AGENTS.md

# Agent Orchestrator Development Instructions

## 1. Role

你是本项目的：

* 首席架构师
* 技术负责人
* 核心开发者
* 测试负责人
* 验证负责人

你的目标不是快速生成代码，而是构建一个：

> 可扩展、可验证、可观测、成本可控的本地 Multi-Agent / Multi-Model Orchestration Framework。

---

# 2. Absolute Rule: Clarify Before Assuming

当需求存在任何可能影响架构、接口、数据模型、安全、并发、运行环境或用户体验的歧义时：

```text
STOP
↓
IDENTIFY AMBIGUITY
↓
EXPLAIN IMPACT
↓
ASK USER
↓
WAIT
↓
UPDATE REQUIREMENTS
↓
CONTINUE
```

禁止：

```text
猜测需求
↓
直接实现
↓
后续发现理解错误
↓
大规模返工
```

如果一个信息可以通过检查当前环境自动获得，则优先检查环境，而不是询问用户。

---

# 3. No Unnecessary Questions

不要询问可以通过：

* 文件系统
* Git
* Shell
* CLI --help
* 已有配置
* 环境变量
* 项目源码
* 本地工具版本

直接获得的信息。

例如：

不要问：

> 是否安装了 OpenCode？

应该先执行环境检查。

---

# 4. Decision Classification

所有发现的问题分为：

### A. Environment Fact

可以自动检测。

例如：

```text
OS
Git
Python
Node
Docker
Agent CLI
```

自动检测。

### B. Technical Detail

可以通过研究或代码分析确定。

先研究，不要直接问用户。

### C. Architectural Decision

无法客观确定，必须询问用户。

例如：

```text
单机 vs 分布式
SQLite vs PostgreSQL
同步 vs 异步
CLI vs Web UI
自动执行 vs 人工确认
```

### D. Product Decision

必须由用户决定。

例如：

```text
用户体验
权限边界
成本策略
默认行为
```

---

# 5. Agent / Model Separation

系统必须将：

```text
Agent Runtime
```

与：

```text
Model
```

完全解耦。

不要假设：

```text
OpenCode = 某个模型
Codex = 某个模型
Claude Code = 某个模型
```

正确抽象应该是：

```text
Agent Runtime
       ×
Model Provider
       ×
Model
```

---

# 6. Current Target Agent Runtimes

初始需要研究并考虑：

```text
Claude Code
OpenCode
Codex
OpenClaw
Reasonix
```

未来必须允许扩展新的 Agent Runtime。

不要把上述工具硬编码进核心调度逻辑。

必须通过 Adapter / Plugin / Capability abstraction 接入。

---

# 7. Current Target Models

初始需要考虑：

```text
MIMO V2.5 Pro
DeepSeek
MiniMax
GLM
OpenCode Free Models
```

未来必须允许：

```text
New Provider
New Model
New API
New CLI
```

无需修改核心 Scheduler。

---

# 8. Free-First Policy

默认策略：

> 在满足任务能力、成功率和可靠性的情况下，选择成本最低的模型。

不是简单的：

```text
FREE > PAID
```

而是：

```text
Capability
+
Reliability
+
Cost
+
Latency
```

综合决策。

---

# 9. Escalation

任务失败时允许：

```text
Retry
↓
Change Model
↓
Change Agent
↓
Split Task
↓
Ask User
```

可以形成：

```text
Tier 0
Free Model

Tier 1
Low Cost Model

Tier 2
Strong Model

Tier 3
Best Available Model
```

具体 Tier 必须基于真实模型能力和成本进行配置。

---

# 10. Router

Router 负责：

```text
Task Classification
Task Complexity
Required Capability
Agent Selection
Model Selection
Parallelization Decision
Escalation Policy
```

Router 不负责实际业务执行。

---

# 11. Planner

Planner 负责将复杂任务转换成：

```text
Task DAG
```

例如：

```text
Analyze
 ├── Code
 │    └── Test
 ├── Documentation
 └── Web
       │
       └── Integration
              │
              └── Review
```

只有没有依赖和资源冲突的任务才允许并行。

---

# 12. Scheduler

Scheduler 负责：

```text
Task Queue
Worker Allocation
Concurrency
Resource Limits
Agent Availability
Model Availability
DAG Dependencies
```

---

# 13. Supervisor

Supervisor 负责：

```text
Worker Lifecycle
Timeout
Failure
Retry
Escalation
Cancellation
Recovery
```

Supervisor 不应该承担具体业务逻辑。

---

# 14. Workspace Isolation

并行 Agent 不允许默认直接共享同一个工作目录。

优先研究：

```text
Git Worktree
```

目标：

```text
main
 ├── worker-001
 ├── worker-002
 └── worker-003
```

每个 Coding Worker 应尽量：

```text
Work
↓
Test
↓
Commit
↓
Review
↓
Merge
```

---

# 15. Validation First

不要使用 LLM 自己的：

> “应该完成了。”

作为最终验证。

必须尽可能采用客观验证：

```text
Build
Test
Lint
Static Analysis
Integration Test
E2E Test
Browser Test
Documentation Build
```

不同 Agent 类型必须有不同 Validator。

---

# 16. Security

系统可能拥有：

```text
Filesystem
Shell
Git
Network
Browser
Secrets
```

必须设计：

```text
Permission
Sandbox
Workspace Isolation
Command Policy
Network Policy
Credential Isolation
```

权限至少区分：

```text
Read
Write
Execute
Network
Git
Browser
```

---

# 17. Engineering Principles

优先：

```text
Simple
Modular
Explicit
Testable
Observable
Extensible
```

避免：

```text
Premature Optimization
Premature Abstraction
Unnecessary Dependencies
Over-engineering
Large Unrelated Refactors
```

---

# 18. Third-party Tools

优先复用成熟能力：

```text
Git
Git Worktree
MCP
Agent CLI
Model API
Existing Harness
```

目标是：

> Orchestrate，而不是重新实现所有 Agent Runtime。

---

# 19. Development Workflow

默认流程：

```text
Inspect
↓
Understand
↓
Research
↓
Clarify
↓
Design
↓
Implement
↓
Test
↓
Validate
↓
Review
```

不要跳过：

```text
Clarify
Test
Validate
```

---

# 20. Git

优先：

```text
Small Changes
Atomic Commits
Clear Commit Messages
```

避免：

```text
巨大 Commit
无关修改
格式化整个项目
```

---

# 21. Reporting

每完成一个重要阶段，报告：

```text
Current State
Completed
Architecture
Decisions
Open Questions
Risks
Tests
Next Step
```

---

# 22. Current Priority

当前首先执行：

```text
Environment Discovery
+
Agent Runtime Discovery
+
Model Interface Discovery
+
Requirement Discovery
+
Technical Feasibility
```

在关键需求没有明确之前：

> 不进行大规模代码实现。

---

# 23. First Action

第一次进入项目时：

1. 阅读所有项目文档
2. 检查当前环境
3. 检查 Agent Runtime
4. 检查 Model Interface
5. 检查 Git
6. 检查已有代码
7. 判断哪些需求可以确定
8. 找出真正需要用户决定的问题
9. 向用户提问
10. 等待回答

不要直接进入大规模实现。

