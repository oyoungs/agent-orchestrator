# Agent Orchestrator Architecture

> 2026-08-03：环境调查、Agent Runtime 调研、Model Provider 调研与需求澄清已完成。以下架构基于已确认决策（DECISIONS.md ADR-0001..0015）。

---

# 1. Architectural Objective

构建：

```text
Agent Runtime × Model × Task × Tool × Workspace × Validator
```

的统一调度体系。

---

# 2. Target Logical Architecture

```text
User
 │
 ▼
Task Gateway (CLI: run / status)
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
 │     ├── Agent Adapter (ACP / Process)
 │     ├── Model
 │     ├── Tools
 │     └── Workspace
 │
 └── Worker
       ├── Agent Adapter
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

负责接收用户任务。MVP 提供 CLI：

```text
agent run <task>     # 提交并执行任务
agent status         # 查看任务状态 / 最近结果
```

未来 API / UI 通过同一 Gateway 接口接入。

## Router

输入：User Task；输出：`TaskProfile`。

```ts
interface TaskProfile {
  taskId: string;
  type: TaskType;                 // "refactor" | "test" | "fix" | "review" | ...
  complexity: "low" | "medium" | "high";
  requiredCapability: Capability[];
  candidateAgents: AgentRuntimeRef[];
  candidateModels: ModelRef[];
  escalationPolicy: EscalationPolicy;
}
```

职责：

- 任务分类（MVP 用规则 + 项目特征检测，不引入 LLM 分类以省成本）；
- 能力匹配（Agent / Model Registry）；
- 成本感知选择（ADR-0003：Capability + Reliability + Cost + Latency）；
- 并行化决策（是否可拆、可并行）。

Router 不承担实际业务执行。

## Planner

负责将复杂任务转换成 Task DAG。

MVP：单任务直通（无拆分），但接口与数据结构按 DAG 设计预留。

```text
Analyze
 ├── Code
 │    └── Test
 ├── Documentation
 └── Web
       └── Integration
             └── Review
```

只有没有依赖和资源冲突的任务才允许并行。

## Scheduler

职责：

- 进程内任务队列（ADR-0007）；
- 并发上限（默认 2，TOML 可配）；
- DAG 依赖：就绪任务才出队；
- Worker 分配：Agent 可用性 + Workspace 分配；
- 资源限制（CPU / 进程数，后续阶段）。

## Worker

负责具体 Task 执行：

```text
created → queued → running → succeeded
                          ├→ failed
                          ├→ timed_out
                          └→ cancelled
```

执行 = `AgentAdapter.invoke(input)` 的事件流消费 + usage 记录。

## Agent Adapter

统一接口（ADR-0011）：

```ts
interface AgentAdapter {
  id: string; // "claude-code" | "opencode" | "codex" | "openclaw" | "reasonix"
  invoke(input: AgentTaskInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  probe(): Promise<ProbeResult>; // 版本 / 可用性 / 认证探测
}

interface AgentTaskInput {
  prompt: string;
  cwd: string;
  model: ModelRef;
  permissions: PermissionSet;
  timeoutMs: number;
  budgetUsd?: number;
  env: Record<string, string>;
}

type AgentEvent =
  | { type: "started"; ts: number }
  | { type: "text"; ts: number; text: string }
  | { type: "tool"; ts: number; tool: string; input: unknown; output?: unknown }
  | { type: "usage"; ts: number; usage: Usage }
  | { type: "finished"; ts: number; exitCode: number; ok: boolean; result?: string; usage?: Usage }
  | { type: "error"; ts: number; errorClass: ErrorClass; message: string };
```

实现：

```text
ACP Adapter        opencode acp / openclaw acp / reasonix acp（stdio NDJSON JSON-RPC）
Claude Adapter     claude -p <prompt> --settings <file> --output-format json
Codex Adapter      codex exec <prompt> --json --sandbox <mode> -m <model>
```

## Model Adapter

MVP 不重复实现模型 API 调用：模型能力由各 Runtime 自身配置提供（ADR-0012）。Model Registry 负责记录 provider / model / 价格 / 能力，用于 Router 决策与成本核算。

```text
DeepSeek / MIMO / MiniMax → 各 Runtime 已配置的 OpenAI / Anthropic 兼容端点
Codex                     → Responses wire API（config.toml）
Claude Code               → --settings 注入 Anthropic 兼容端点
```

## Supervisor

职责（不承担业务逻辑）：

```text
Timeout         默认 300s（TOML 可配），进程级硬超时
Retry           默认 1 次
Escalation      free → cheap → strong（模型 / 运行时升级）
Cancellation    SIGTERM → SIGKILL
Recovery        记录失败现场，允许重新入队
```

## Validator

MVP 支持按任务类型选择验证器：

```text
build    编译通过
test     测试通过
lint     静态检查通过
diff     变更范围审查（人工确认）
```

任务成功与否由 Validator 判定，而不是 Agent 的「我认为完成了」。

---

# 4. Data Model

## 4.1 Entities

### task

```text
id, parent_id, dag_group,
type, prompt, status,
agent_id, model_id, workspace_id,
priority, retry_count,
created_at, updated_at, started_at, finished_at,
result_summary
```

### agent_runtime

```text
id, name, kind (claude-code|opencode|codex|openclaw|reasonix),
version, cli_path, capabilities (json), config_ref,
available, last_checked_at
```

### model

```text
id, provider, model_id, wire_api,
base_url, auth_ref, context_window, max_output,
unit_prices (json: input / output / cache_read / cache_write),
capabilities (json: tool_calling / streaming / reasoning),
free, available
```

### worker_run

```text
id, task_id, agent_id, model_id, workspace_path,
status, exit_code,
started_at, finished_at, error_class, raw_output_ref
```

### usage_record

```text
id, run_id, provider, model,
input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
reasoning_tokens, latency_ms, cost_usd,
source (provider | agent-reported)
```

### metric_event

```text
id, run_id, event_type, ts, payload (json)
```

## 4.2 SQLite Tables（Phase 2 落地）

```text
tasks
agent_runtimes
models
worker_runs
usage_records
metric_events
```

---

# 5. Task Lifecycle State Machine

```text
created
  ↓
queued
  ↓
running ──────────────→ succeeded
  ├─→ failed ──→ retrying ──→ queued
  ├─→ timed_out ──→ escalation ──→ queued
  ├─→ cancelled
  └─→ validation_failed ──→ (retry | escalate | ask_user)
```

状态与转换由 Scheduler / Supervisor / Validator 驱动，全部落库。

---

# 6. Error Classification

```text
agent_crash         进程异常退出
agent_timeout       超过 timeoutMs
agent_cli_failure   非零退出且无结构化结果
auth_error          401 / key 失效 / 未登录
model_error         API 错误 / 无效响应 / rate limit
validation_failure  Validator 判定失败
workspace_conflict  git / 文件冲突
```

Error Class → 重试 / 升级 / 询问用户的策略映射由 Router Policy 决定（Future ADR）。

---

# 7. Workspace Strategy

按 ADR-0009：

```text
有 git 仓库  → git worktree add worker-<id>
无 git 仓库 → cp -R 副本 → Worker 执行 → diff -ruN → 人工确认 apply
```

每个 Coding Worker 的推荐循环：

```text
Work → Test → Commit → Review → Merge
```

MVP 并行度默认 2，冲突时降级为串行。

---

# 8. Security Model

按 ADR-0010，分层：

```text
Layer 1  Runtime 原生权限（deny-by-default，各 Runtime 配置）
Layer 2  Orchestrator 审批门（高风险动作 → 人工确认）
Layer 3  审计日志（JSONL：谁 / 何时 / 做了什么 / 结果）
```

高风险动作（MVP 默认需人工确认）：

```text
git:push
network 访问
workspace 外文件写入
凭据读取
```

凭据规则（SECURITY.md §4）：

- 从各 Runtime 配置读取，禁止写入日志 / 任务记录 / prompt；
- 日志组件统一脱敏（key / token / secret / password 字段）。

---

# 9. Observability

## 日志（JSONL）

```text
{"ts":..., "level":"info", "event":"task.started", "taskId":"...", "runId":"...", "workerId":"...", "payload":{...}}
```

事件类型：`task.*` / `worker.*` / `supervisor.*` / `validator.*` / `approval.*`。

## 指标（SQLite）

```text
usage_records   成本 / token / 延迟
metric_events   成功率 / 失败率 / 重试率 / 模型表现 / Agent 表现
```

## 成本核算

`cost = usage × unit_price`（ADR-0014），不信任 Agent 上报 cost。

---

# 10. Configuration（TOML）

```toml
[orchestrator]
concurrency = 2
default_timeout_sec = 300
default_retries = 1

[router]
free_first = true
escalation = ["flash", "pro", "strongest"]

[workspace]
mode = "hybrid"   # worktree | copy

[approvals]
require_human = ["git:push", "network", "fs:write-outside-workspace"]

[[agents]]
id = "claude-code"
settings = "~/.claude/settings-deepseek.json"
permission_mode = "plan"

[[agents]]
id = "codex"
sandbox = "workspace-write"

[[agents]]
id = "opencode"
model = "opencode/deepseek-v4-flash-free"

[[agents]]
id = "openclaw"
agent = "main"
gateway = "ws://127.0.0.1:18789"

[[agents]]
id = "reasonix"
model = "deepseek-v4-flash"
budget = 1

[models.deepseek-v4-flash]
provider = "deepseek"
context = 1_000_000
price_input = 0.14
price_output = 0.28
price_cache_read = 0.028

[models.mimo-v2.5-free]
provider = "opencode"
free = true
```

---

# 11. Directory Layout

```text
agent-orchestrator/
├── src/
│   ├── cli/            # run, status
│   ├── gateway/        # Task Gateway
│   ├── router/
│   ├── planner/
│   ├── scheduler/
│   ├── worker/
│   ├── supervisor/
│   ├── validator/
│   ├── adapters/       # acp/ claude/ codex/
│   ├── registry/       # Agent / Model Registry
│   ├── store/          # SQLite
│   ├── security/       # 审批门、脱敏
│   └── observability/  # JSONL 日志、指标
├── config/             # 默认 TOML
├── test/
└── docs/
```

---

# 12. Open Questions → Decisions

原开放问题（2026-08-03 前）已全部决策：

| 开放问题 | 决策 | ADR |
|---|---|---|
| Primary Language | TypeScript + Node 26 | 0006 |
| Runtime | Node.js | 0006 |
| CLI Framework | commander（Phase 2 定细节） | 0006 |
| Persistence | SQLite | 0007 |
| Queue | 进程内队列 | 0007 |
| Event Bus | 无（未来再评估） | 0007 |
| Concurrency Model | 单进程异步 + Worker 进程组 | 0006 |
| Agent Adapter Protocol | ACP-first 混合 | 0011 |
| Model Adapter Protocol | OpenAI 兼容为主 + Responses + Anthropic env | 0012 |
| MCP Integration | 复用 Runtime 原生 MCP；自身 MCP 化放 Phase 11 | 0011 |
| Sandbox | Runtime 原生权限 + 审批门 | 0010 |
| Containerization | 不用（MVP） | 0009 |
| Git Worktree Strategy | 混合（worktree / 目录副本） | 0005/0009 |
| State Machine | 本文档 §5 | — |
| Observability | JSONL + SQLite metrics | 0014 |
| Logging | JSONL | 0014 |
| Metrics | usage_records + metric_events | 0014 |
| Configuration Format | TOML | 0013 |

---

# 13. Architecture Evolution

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
