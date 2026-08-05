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

## 管理平面（Daemon）

守护进程持有：

```text
SQLite 存储
任务队列
Model Registry（用户管理，初始为空）
Management API（本机回环 HTTP + token 鉴权）
```

CLI 客户端与未来的 WebUI 都通过 Management API 操作模型与任务。模型添加、更新、移除是运行时操作，无需重启 daemon（ADR-0017）。

---

# 3. Core Components

## Task Gateway

负责接收用户任务。MVP 提供 CLI：

```text
agent run <task>     # 提交并执行任务
agent status         # 查看任务状态 / 最近结果
```

未来 API / UI 通过同一 Gateway 接口接入。

## Management Gateway（Daemon）

负责模型与系统配置的运行时管理（FR-013/014）：

```text
agent model add     添加模型（连接信息 / 计费方式 / 支持能力）
agent model list    查看已注册模型
agent model update  修改价格、能力、连接、状态
agent model remove  移除失效模型
agent model disable 临时下线
```

所有变更写入 SQLite 并记录审计日志。初始注册表为空。

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

Orchestrator **不内置任何特定模型的接入实现**（ADR-0016）。用户通过管理入口把自己购买的模型加入 Model Registry；运行时按用户存储的连接信息把端点传给所选 Agent Runtime。仅当 Orchestrator 需要直接调用模型（如连接探测）时，才按注册的 wire protocol 发起请求。

```text
OpenAI 兼容  → 默认 wire protocol（DeepSeek / MIMO / MiniMax / Qwen 等）
Responses    → 供 Codex 使用（用户添加模型时选择）
Anthropic    → 供 Claude Code 使用（--settings 注入）
```

Model Registry 负责记录 provider / model / 计费方式 / 支持能力 / 状态，用于 Router 决策与成本核算（FR-002 / ADR-0012）。

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
id, name, provider, model_id,
wire_api (openai-compatible | anthropic | responses),
base_url, auth_ref,
billing (json: type / unit_prices / currency),
capabilities (json: context_window / max_output /
              tool_calling / streaming / reasoning / modalities),
status (active | disabled | error),
created_at, updated_at, added_by
```

初始为空；由用户通过 Management API 添加（ADR-0016）。

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
model_change_log
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

模型凭据（ADR-0016）：

- 用户添加模型时只保存凭据引用（环境变量名 / 加密文件），禁止明文入库；
- Management API 仅绑定 127.0.0.1 且需 token 鉴权；
- 模型变更（add / update / remove / disable）写入审计日志。

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
# 示例配置。默认安装：模型注册表为空，
# 需先通过 `agent model add` 添加模型，本文件不含任何模型接入配置。

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
# model = "<已注册模型 id>"  # 示例：模型需先通过 agent model add 添加

[[agents]]
id = "openclaw"
agent = "main"
gateway = "ws://127.0.0.1:18789"

[[agents]]
id = "reasonix"
# model = "<已注册模型 id>"
budget = 1
```

# 模型注册表（models）不写在静态配置中，由 daemon 运行时管理。

---

# 11. Directory Layout

```text
agent-orchestrator/
├── src/
│   ├── cli/            # run, status, model 管理命令（daemon 客户端）
│   ├── daemon/         # 守护进程：Management API、注册表、队列宿主
│   ├── webui/          # 管理后台（后续阶段）
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
| Model Registry Ownership | 用户运行时管理，初始为空 | 0016 |
| Management Interface | daemon + CLI（WebUI 后续） | 0017 |
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
