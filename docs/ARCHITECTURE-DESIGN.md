# Agent Orchestrator 软件架构设计蓝图

> 版本：0.1.0（2026-08-05）
> 依据：SPEC.md / ARCHITECTURE.md / DECISIONS.md（ADR-0001..0017）/ ROADMAP.md / TESTING.md / SECURITY.md
> 状态：架构已确认，Phase 2（MVP）实施前蓝本

---

# 1. 总体架构概览

## 1.1 系统定位

本地运行的 Multi-Agent / Multi-Model Orchestrator：

```text
用户任务 → 路由 → 规划 → 调度 → 并行 Worker → Agent Runtime + 模型 → 验证 → 结果
```

模型注册表**用户管理、初始为空**（ADR-0016）；daemon 提供管理入口（ADR-0017）。

## 1.2 进程视图

```text
┌─────────────────────────────────────────────────────────────────┐
│ 用户侧                                                          │
│   agent CLI（交互入口）           WebUI（后续 Phase 11）          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP（127.0.0.1 + token）
┌───────────────────────────────▼─────────────────────────────────┐
│ agentd（项目后台守护进程，单进程）                                 │
│   Management API → Task Gateway → Router → Planner → Scheduler   │
│   Model Registry / Agent Registry / SQLite / 队列 / Supervisor   │
│   Worker → Agent Adapter（ACP / Process）→ Validator             │
└───────┬────────────────────────────┬─────────────────────────────┘
        │ spawn / stdio               │ HTTP
┌───────▼──────────┐        ┌─────────▼───────────┐
│ Agent Runtime    │        │ 模型 API（用户购买）  │
│ claude / opencode │       │ OpenAI 兼容 /        │
│ codex / openclaw │       │ Responses / Anthropic│
│ reasonix         │        └─────────────────────┘
└──────────────────┘
```

## 1.3 两条核心数据流

**任务链路（Phase 2 打通）：**

```text
agent run "<task>"
  → POST /v1/tasks
  → TaskService.submit（落库 tasks，入队）
  → Router（分类 + 能力/成本匹配，选模型）
  → Planner（MVP 单任务直通）
  → Scheduler（并发 ≤ 2，出队）
  → Worker（分配 Workspace）
  → AgentAdapter.invoke（ACP / claude -p / codex exec）
  → Agent Runtime 调用用户添加的模型
  → 事件流（text/tool/usage）→ usage_records 落库
  → Validator（build/test/lint）
  → 结果回写 tasks
```

**模型管理链路（Phase 2 必须先行）：**

```text
agent model add qwen3 ...
  → POST /v1/models
  → 校验（连接信息 / 计费方式 / 支持能力）
  → 落库 models + 审计 model_change_log
  → agent model list / update / remove / disable
```

## 1.4 技术选型总览

| 关注点 | 选型 | 决策依据 |
|---|---|---|
| 语言 / 运行时 | TypeScript + Node.js 26 | ADR-0006（Node 生态，流式 JSON 友好） |
| 包管理 | pnpm | ADR-0006 |
| CLI 框架 | commander + zod 参数校验 | ADR-0008 / ADR-0013 |
| 持久化 | SQLite（better-sqlite3，WAL） | ADR-0007 |
| 队列 | 进程内队列（p-queue 或自研轻量实现） | ADR-0007 |
| Management API | Node HTTP（loopback + token），REST 风格 /v1 | ADR-0017 |
| Agent 接入 | ACP-first + Claude / Codex 进程适配器 | ADR-0011 |
| 模型接入 | 不内置；OpenAI 兼容为主 + Responses + Anthropic | ADR-0012 / ADR-0016 |
| 配置 | TOML（smol-toml） | ADR-0013 |
| 日志 | JSONL（轻量自研 logger，零依赖优先） | ADR-0014 |
| 测试 | vitest + 真实 CLI 集成测试 | TESTING.md |
| 类型校验 | zod | 通用 |
| 鉴权 | daemon token（启动生成，0600） | ADR-0017 / SECURITY.md |

---

# 2. 组件设计（技术选型 / 方案设计 / TODO）

> 每个组件给出：技术选型（含理由）、方案设计（关键接口与要点）、TODO 清单（实施顺序）。

## C1 · CLI（agent）

### 技术选型

- **commander**：成熟、声明式子命令（`run` / `status` / `model` / `daemon`）；
- **zod**：参数与交互输入校验（模型字段、价格、能力）；
- 输出双格式：人读（默认）与 `--json`（供脚本 / WebUI 使用）。

### 方案设计

```text
agent run <task>                         提交任务并轮询状态
agent status [taskId]                    查看最近任务 / 指定任务
agent model add ...                      添加模型（见下）
agent model list                         列出已注册模型
agent model update <id> ...              更新价格 / 能力 / 连接
agent model remove <id>                  移除失效模型
agent model disable <id>                 临时下线
agent daemon start | stop | status       管理后台守护进程
```

CLI 是 daemon 的纯客户端：不直接读 SQLite、不直接 spawn Agent Runtime，所有操作走 Management API。daemon 未运行时报错并提示启动命令。

### TODO

- [ ] T1 工程脚手架：pnpm init、tsconfig（NodeNext）、vitest、eslint
- [ ] T2 commander 子命令骨架（run / status / model / daemon）
- [ ] T3 `model add` 参数与 zod 校验（--provider --base-url --model-id --wire-api --billing --price-input --price-output --capabilities --auth-env）
- [ ] T4 `model list / update / remove / disable`
- [ ] T5 `run <task>` 提交 + 轮询（间隔可配）
- [ ] T6 `status` 与 `--json` 输出
- [ ] T7 daemon 未运行友好报错（Errno ECONNREFUSED 检测）

## C2 · Daemon（agentd）

### 技术选型

- Node.js 单进程（事件循环承载 HTTP + 队列 + 子进程管理）；
- HTTP 用内置 `node:http`（MVP 零依赖）或 fastify（如需 OpenAPI）；MVP 建议 `node:http` + 手写路由；
- 单实例：pidfile + 端口占用检测；
- 生命周期：SIGTERM/SIGINT 优雅关闭（停止取任务 → 等运行中任务收尾或标记 interrupted → 关闭 HTTP）。

### 方案设计

```text
agentd
├── http.ts            Management API 入口（token 中间件）
├── lifecycle.ts       启动 / 优雅关闭 / 崩溃恢复
├── registry-host.ts   Model Registry + Agent Registry 宿主
├── queue-host.ts      任务队列宿主
└── index.ts           main
```

启动顺序：加载 TOML → 初始化 SQLite（migrations）→ 生成/读取 daemon token → 启动 HTTP → 恢复中断任务（running → interrupted）→ 就绪。

数据目录：`.agent-orchestrator/`（daemon.db、daemon.token、logs/、runs/），已在 .gitignore。

### TODO

- [ ] T1 `agent daemon start/stop/status`
- [ ] T2 HTTP server（loopback 绑定，随机或固定端口写入 state 文件）
- [ ] T3 token 生成（crypto.randomBytes → base64url，0600）
- [ ] T4 SQLite 初始化 + migrations（schema_version）
- [ ] T5 优雅关闭与信号处理
- [ ] T6 崩溃恢复：启动时 `running → interrupted`
- [ ] T7 单实例锁与端口冲突检测

## C3 · Management API

### 技术选型

- REST 风格 JSON over HTTP，路径前缀 `/v1`；
- token 鉴权：`Authorization: Bearer <token>`；
- 错误统一格式 `{ "error": { "code", "message", "details?" } }`；
- 所有写操作（模型变更）写审计日志。

### 方案设计（端点）

| Method | Path | 说明 |
|---|---|---|
| GET | /v1/health | 健康检查 |
| POST | /v1/models | 添加模型 |
| GET | /v1/models | 模型列表 |
| GET | /v1/models/:id | 模型详情 |
| PATCH | /v1/models/:id | 更新模型 |
| DELETE | /v1/models/:id | 移除模型 |
| POST | /v1/models/:id/probe | 连接探测 |
| POST | /v1/tasks | 提交任务 |
| GET | /v1/tasks | 任务列表 |
| GET | /v1/tasks/:id | 任务状态 / 结果 |
| POST | /v1/tasks/:id/cancel | 取消任务 |

### TODO

- [ ] T1 token 中间件 + 请求日志（脱敏）
- [ ] T2 models CRUD 端点
- [ ] T3 probe 端点（对接 C12）
- [ ] T4 tasks 提交 / 查询 / 取消端点
- [ ] T5 统一错误格式与 4xx/5xx 语义
- [ ] T6 路由表与请求/响应类型（TS 共享类型文件）

## C4 · Task Gateway

### 技术选型

- 纯业务服务（无框架），依赖 Model Registry 与队列；
- taskId 使用 `crypto.randomUUID()`。

### 方案设计

```ts
interface TaskService {
  submit(input: { prompt: string; type?: TaskType }): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  list(filter?: TaskFilter): Promise<Task[]>;
  cancel(id: string): Promise<void>;
}
```

提交即落库（`created`）并入队；查询直接读 SQLite。

### TODO

- [ ] T1 TaskService.submit（分类委托 Router → 落库 → 入队）
- [ ] T2 get / list / cancel
- [ ] T3 提交去重与参数校验（空 prompt 拒绝）

## C5 · Model Registry（用户管理）

### 技术选型

- Service + Repository 分层，SQLite 持久化；
- zod schema 定义模型记录（计费方式、能力、连接、状态）；
- 凭据只存**引用**（环境变量名 / 加密文件路径），禁止明文（SECURITY.md §4 / ADR-0016）。

### 方案设计

```text
ModelRecord {
  id, name, provider, modelId,
  wireApi: "openai-compatible" | "anthropic" | "responses",
  baseUrl, authRef,
  billing: { type: "free" | "pay-as-you-go" | "subscription" | "token-plan" | "local",
             unitPrices?: { input, output, cacheRead?, cacheWrite? }, currency },
  capabilities: { contextWindow, maxOutput, toolCalling, streaming, reasoning, modalities[] },
  status: "active" | "disabled" | "error",
  createdAt, updatedAt, addedBy
}
```

计费方式枚举：`free / pay-as-you-go / subscription / token-plan / local`。

生命周期：`add → active`；探测失败 → `error`；用户可 `disable` / `remove`。

### TODO

- [ ] T1 ModelRepository CRUD（SQLite）
- [ ] T2 zod schema（billing / capabilities / wire_api 校验）
- [ ] T3 凭据引用存储（auth-env 校验存在性，不读值）
- [ ] T4 model_change_log 审计
- [ ] T5 状态转换（error/disabled 语义）
- [ ] T6 唯一约束（provider + modelId）

## C6 · Agent Registry

### 技术选型

- 静态声明（TOML `[[agents]]`）+ 运行时 probe；
- probe = `which <cli>` + `<cli> --version`（缓存结果，TTL 可配）。

### 方案设计

```text
AgentRuntime {
  id, kind (claude-code|opencode|codex|openclaw|reasonix),
  cliPath, version, available, lastCheckedAt,
  capabilities: { acp, nonInteractive, permissions[] },
  compatibleWireApis: ["openai-compatible", "anthropic", "responses", ...]
}
```

Agent ↔ Model 兼容表（Router 使用）：

| Agent | 可用的 wire_api |
|---|---|
| Claude Code | anthropic（--settings 注入） |
| Codex | responses（config.toml） |
| OpenCode / OpenClaw / Reasonix | openai-compatible（或 ACP 通道） |

### TODO

- [ ] T1 读取 `[[agents]]` 配置声明
- [ ] T2 probe 实现 + 缓存（which / --version）
- [ ] T3 可用性状态维护与刷新
- [ ] T4 Agent ↔ wire_api 兼容表

## C7 · Router

### 技术选型

- 规则引擎（关键词 + 项目特征检测），MVP 不引入 LLM 分类（省成本）；
- 成本排序：`unitPrices × 预估 token 量`，free-first（ADR-0003）。

### 方案设计

```text
TaskProfile {
  type, complexity,
  requiredCapability[],
  candidateAgents[], candidateModels[],
  escalationPolicy
}
```

分类规则示例：

```text
"重构" / "refactor"          → type=refactor
"修复" / "fix" / "bug"       → type=fix
"测试" / "test"              → type=test
"审查" / "review"            → type=review
项目特征：package.json / CMakeLists.txt / Cargo.toml → 语言维度
```

模型选择：过滤（context_window ≥ 任务预估、tool_calling 等）→ 排序（cost 升序，能力满足优先）→ 生成 tier 列表（flash → pro → strongest）。

### TODO

- [ ] T1 关键词 + 项目特征分类器
- [ ] T2 能力过滤（context / tool / streaming）
- [ ] T3 成本排序（free-first）
- [ ] T4 escalation tier 生成
- [ ] T5 单元测试（分类 / 排序 / 降级）

## C8 · Planner

### 技术选型

- 纯数据层：TaskDAG 类型定义 + 单任务直通；Phase 4 再实现分解器。

### 方案设计

```ts
type TaskDAG = {
  root: TaskNode;
  nodes: TaskNode[];
  edges: Array<{ from: string; to: string }>;
};
type TaskNode = { id: string; type: TaskType; prompt: string; deps: string[] };
```

MVP：`plan(task) → { root, nodes: [task], edges: [] }`。

### TODO

- [ ] T1 TaskDAG / TaskNode 类型
- [ ] T2 单任务直通实现
- [ ] T3 分解器接口预留（Phase 4）

## C9 · Scheduler

### 技术选型

- 进程内队列：MVP 自研轻量（Promise 链 + 并发信号量）或 `p-queue`；
- 并发上限默认 2（TOML），冲突时降级串行。

### 方案设计

```text
调度循环：
  pending 队列（按优先级）
  → 就绪检查（无未满足依赖，Phase 4）
  → 信号量获取
  → 分配 Worker（Agent 可用 + Workspace 可分配）
  → 执行 → 释放信号量
```

### TODO

- [ ] T1 队列 + 并发信号量
- [ ] T2 优先级排序
- [ ] T3 Worker 分配（Agent 可用性 + Workspace）
- [ ] T4 DAG 就绪检查（Phase 4）

## C10 · Worker

### 技术选型

- 单任务执行器：prep workspace → adapter.invoke → 事件消费 → usage → validator；
- raw 输出落盘 `runs/<taskId>/output.jsonl`。

### 方案设计

```text
Worker.run(task):
  1. workspace = WorkspaceManager.allocate(task)
  2. adapter = AgentAdapterFactory.create(agent, model)
  3. for await (event of adapter.invoke(input)):
       - text/tool → runs/<taskId>/output.jsonl
       - usage → usage_records（provider usage × price）
  4. ok = Validator.run(task, workspace)
  5. 结果回写 tasks；释放 workspace
```

### TODO

- [ ] T1 Worker 执行循环
- [ ] T2 事件流落盘
- [ ] T3 usage 记录
- [ ] T4 workspace 分配 / 释放

## C11 · Agent Adapter（ACP + Process）

### 技术选型

- ACP 适配器：spawn `opencode acp` / `openclaw acp` / `reasonix acp`，NDJSON JSON-RPC 2.0 最小客户端（手写，避免未成熟依赖）；
- Claude 适配器：`claude -p <prompt> --settings <file> --output-format json --permission-mode <mode>`；
- Codex 适配器：`codex exec <prompt> --json --sandbox <mode> -m <model>`；
- 统一接口（ADR-0011）：

```ts
interface AgentAdapter {
  id: string;
  invoke(input: AgentTaskInput): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  probe(): Promise<ProbeResult>;
}
```

### 方案设计要点

- 所有适配器必须设置**进程级硬超时**（Claude 401 会重试 11 次，实测）；
- 认证失败（401 / invalid key）→ `auth_error`，快速失败不重试；
- 统一事件：started / text / tool / usage / finished / error；
- 输出解析：Claude 单 JSON result；Codex JSONL；OpenCode JSONL；OpenClaw JSON envelope；Reasonix 流式文本 + 摘要；
- 成本：不信任 Agent 上报 cost（ADR-0014），用 usage × 价格表。

### TODO

- [ ] T1 AgentAdapter 接口 + 工厂
- [ ] T2 ACP 最小 client（NDJSON JSON-RPC）
- [ ] T3 Claude 进程适配器（json 解析 / 硬超时 / 权限模式）
- [ ] T4 Codex 进程适配器（JSONL 解析 / sandbox）
- [ ] T5 事件归一化 + 错误分类
- [ ] T6 probe（版本 / 认证探测）
- [ ] T7 真实 CLI 集成测试（TESTING §11 基线）

## C12 · Model Connector（探测）

### 技术选型

- 零依赖：`fetch` + zod；
- 默认 OpenAI 兼容探测：`GET /models` 或最小 `POST /chat/completions`（max_tokens=1）；
- 错误分类：401 auth / 429 rate limit / 5xx / timeout。

### 方案设计

```text
probe(model):
  wire_api = openai-compatible → GET {baseUrl}/models
  wire_api = anthropic        → POST {baseUrl}/v1/messages（最小请求）
  wire_api = responses        → POST {baseUrl}/responses（最小请求）
  成功 → status=active；401 → status=error + 提示用户处理
```

### TODO

- [ ] T1 OpenAI 兼容探测客户端
- [ ] T2 Anthropic / Responses 探测（后续）
- [ ] T3 错误分类与状态回写

## C13 · Supervisor

### 技术选型

- AbortController + 子进程 kill（SIGTERM → SIGKILL）；
- 重试策略：次数（默认 1）+ 指数退避；
- 升级阶梯：`free → cheap → strong`（基于 Router 生成的 tier 列表）。

### 方案设计

```text
事件 → 判定：
  auth_error      → 不重试，标记 error，提示用户
  agent_timeout   → retry（换模型/换运行时）→ escalate
  validation_fail → retry → ask_user
  agent_crash     → retry → escalate
取消：CLI 取消 → SIGTERM → 5s → SIGKILL
```

### TODO

- [ ] T1 超时器（AbortController + kill）
- [ ] T2 重试与退避
- [ ] T3 升级阶梯（模型 / 运行时切换）
- [ ] T4 取消语义（SIGTERM → SIGKILL）
- [ ] T5 失败现场记录（raw output 保留）

## C14 · Validator

### 技术选型

- 子进程执行器：`cwd` 内运行构建/测试/lint 命令；
- 任务类型 → 验证器集合映射。

### 方案设计

```text
type=refactor → build + test + lint
type=fix      → build + test
type=test     → test
type=review   → diff 审查（人工确认）
```

命令根据项目语言探测（package.json → pnpm test；CMake → cmake --build；Cargo → cargo test）。

### TODO

- [ ] T1 子进程执行器（exit code + 输出捕获）
- [ ] T2 type → validator 映射
- [ ] T3 结构化验证结果（pass / fail + 证据）
- [ ] T4 diff 审查提示（人工确认）

## C15 · Workspace Manager

### 技术选型

- 混合策略（ADR-0009）：有 git 仓库 → worktree；无 → `cp -R` 副本；
- merge 由人工确认（MVP）。

### 方案设计

```text
allocate(task):
  repo = detectGit(target)
  repo → git worktree add .agent-orchestrator/ws/<taskId> <base>
  !repo → cp -R target .agent-orchestrator/ws/<taskId>
collectDiff(task):
  repo → git diff（worktree 相对 base）
  !repo → diff -ruN base copy
release(task):
  移除 worktree / 副本；保留 diff 供确认
```

### TODO

- [ ] T1 git worktree 创建 / 清理
- [ ] T2 cp -R 副本 + 清理
- [ ] T3 diff 生成与落盘
- [ ] T4 merge 人工确认流程（Phase 5）

## C16 · Security

### 技术选型

- 三层模型（ADR-0010）：Runtime 原生权限 → Orchestrator 审批门 → 审计日志；
- daemon token：crypto 生成，0600 文件；
- 脱敏：统一正则处理 key/token/secret/password 字段。

### 方案设计

```text
审批门（MVP 简单实现）：
  高风险动作（git:push / network / workspace 外写入 / 凭据读取）
  → CLI 交互确认 Y/N → 记录 approval.* 审计事件

凭据：
  模型凭据只存引用（env 名 / 加密文件）
  日志、任务记录、prompt 禁止包含明文
```

### TODO

- [ ] T1 daemon token 生成 / 校验
- [ ] T2 审批门（交互确认）
- [ ] T3 脱敏工具 + 单元测试
- [ ] T4 审计日志（approval.* / model.*）
- [ ] T5 安全测试（TESTING §9：越权文件 / 命令 / 网络 / 密钥泄露 / 逃逸）

## C17 · Observability

### 技术选型

- JSONL 日志（自研轻量 logger，零依赖）；
- 指标与成本落 SQLite（usage_records / metric_events）；
- 成本核算：`usage × unit_price`（ADR-0014）。

### 方案设计

```text
日志事件：task.* / worker.* / supervisor.* / validator.* / approval.* / model.*
metric_event 类型：
  task.success / task.failure / task.retry
  worker.latency / worker.crash
  model.error / model.auth_error
```

### TODO

- [ ] T1 JSONL logger（ts / level / event / payload）
- [ ] T2 usage_record 写入
- [ ] T3 metric_event 写入
- [ ] T4 成本核算模块（provider usage × price）

## C18 · SQLite Store

### 技术选型

- better-sqlite3（同步、快、类型友好）；
- WAL + busy_timeout；migrations 用 schema_version 表；
- 单写者模型（写集中在 daemon 进程）。

### 方案设计

表清单（DDL 见 §3）：tasks / agent_runtimes / models / model_change_log / worker_runs / usage_records / metric_events。

### TODO

- [ ] T1 better-sqlite3 集成 + 连接封装
- [ ] T2 migrations 机制
- [ ] T3 7 张表 DDL 落地
- [ ] T4 索引与查询封装（Repository）

## C19 · WebUI（后续阶段）

### 技术选型

- 复用 /v1 Management API；技术栈 Phase 11 再评估（React/Vue/Svelte + 构建工具）；
- 与 daemon 同源托管（daemon 静态服务 dist/）。

### 方案设计

```text
管理后台页面：
  模型管理（添加 / 列表 / 更新 / 移除 / 探测）
  任务面板（提交 / 状态 / 结果 / 取消）
  成本与指标面板（后续 Phase 9）
```

### TODO

- [ ] T1 技术选型评估（Phase 11 前置）
- [ ] T2 模型管理页
- [ ] T3 任务面板
- [ ] T4 与 daemon 鉴权对接

---

# 3. 数据模型与 SQLite Schema

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  parent_id      TEXT,
  dag_group      TEXT,
  type           TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL,
  agent_id       TEXT,
  model_id       TEXT,
  workspace_id   TEXT,
  priority       INTEGER NOT NULL DEFAULT 0,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  started_at     INTEGER,
  finished_at    INTEGER,
  result_summary TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE agent_runtimes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  version        TEXT,
  cli_path       TEXT,
  capabilities   TEXT,
  config_ref     TEXT,
  available      INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER
);

CREATE TABLE models (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  wire_api     TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  auth_ref     TEXT,
  billing      TEXT NOT NULL,      -- json
  capabilities TEXT NOT NULL,      -- json
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  added_by     TEXT
);
CREATE UNIQUE INDEX idx_models_provider_model ON models(provider, model_id);

CREATE TABLE model_change_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  payload    TEXT,
  actor      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE worker_runs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  agent_id       TEXT,
  model_id       TEXT,
  workspace_path TEXT,
  status         TEXT NOT NULL,
  exit_code      INTEGER,
  started_at     INTEGER,
  finished_at    INTEGER,
  error_class    TEXT,
  raw_output_ref TEXT
);

CREATE TABLE usage_records (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  provider           TEXT,
  model              TEXT,
  input_tokens       INTEGER DEFAULT 0,
  output_tokens      INTEGER DEFAULT 0,
  cache_read_tokens  INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens   INTEGER DEFAULT 0,
  latency_ms         INTEGER,
  cost_usd           REAL,
  source             TEXT NOT NULL DEFAULT 'provider'
);

CREATE TABLE metric_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT,
  event_type TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  payload    TEXT
);
```

---

# 4. 任务状态机与错误处理

```text
created → queued → running → succeeded
                ├→ failed → retrying → queued
                ├→ timed_out → escalation → queued
                ├→ cancelled
                └→ validation_failed → (retry | escalate | ask_user)
```

| 错误类别 | 触发 | 默认处理 |
|---|---|---|
| auth_error | 401 / key 失效 | 不重试，标记 error，提示用户 |
| agent_timeout | 超过程序级超时 | retry（换模型/运行时）→ escalate |
| agent_crash | 进程异常退出 | retry → escalate |
| agent_cli_failure | 非零退出且无结构化结果 | retry → ask_user |
| model_error | API 错误 / rate limit | retry（退避）→ escalate |
| validation_failure | Validator 判定失败 | retry → ask_user |
| workspace_conflict | git / 文件冲突 | ask_user |

---

# 5. 安全设计

```text
Layer 1  Runtime 原生权限（claude --permission-mode / codex --sandbox /
          opencode allow-deny / reasonix shellAllowed / openclaw approvals）
Layer 2  Orchestrator 审批门（高风险动作人工确认）
Layer 3  审计日志（JSONL + model_change_log）
```

要点：

- Management API 仅绑定 127.0.0.1，Bearer token 鉴权；
- 模型凭据只存引用，禁止明文入库 / 日志 / prompt；
- 日志统一脱敏（key / token / secret / password / cookie）；
- 高风险动作清单默认：git:push / network / workspace 外写入 / 凭据读取。

---

# 6. 可观测性

```text
日志（JSONL）：
{"ts":..., "level":"info", "event":"task.started", "taskId":"...", "runId":"...", "workerId":"...", "payload":{...}}

指标（SQLite）：
usage_records  成本 / token / 延迟（source=provider，权威）
metric_events  成功率 / 失败率 / 重试率 / 模型表现 / Agent 表现
```

成本核算：`cost = usage × unit_price`，不信任 Agent 上报 cost（ADR-0014 实测教训）。

---

# 7. 配置（TOML）

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
# model = "<已注册模型 id>"

[[agents]]
id = "openclaw"
agent = "main"
gateway = "ws://127.0.0.1:18789"

[[agents]]
id = "reasonix"
# model = "<已注册模型 id>"
budget = 1
```

模型注册表**不写入静态配置**，由 daemon 运行时管理（`agent model add`）。

---

# 8. 目录结构

```text
agent-orchestrator/
├── src/
│   ├── cli/            # run / status / model / daemon 命令（daemon 客户端）
│   ├── daemon/         # 守护进程：HTTP、生命周期、宿主
│   ├── webui/          # 管理后台（后续阶段）
│   ├── gateway/        # Task Gateway
│   ├── router/
│   ├── planner/
│   ├── scheduler/
│   ├── worker/
│   ├── supervisor/
│   ├── validator/
│   ├── adapters/       # acp/ claude/ codex/ + 工厂
│   ├── connector/      # Model Connector（探测）
│   ├── workspace/      # Workspace Manager
│   ├── registry/       # Model / Agent Registry
│   ├── store/          # SQLite + migrations
│   ├── security/       # token / 审批门 / 脱敏
│   └── observability/  # JSONL 日志 / 指标
├── config/             # 默认 TOML
├── docs/
├── test/
└── package.json
```

运行时数据（gitignore）：`.agent-orchestrator/`（daemon.db / daemon.token / logs/ / runs/ / ws/）。

---

# 9. 测试策略

```text
单元测试     Router 分类 / 成本排序 / Registry CRUD / 脱敏 / 状态机
集成测试     Gateway→Registry→Scheduler→Worker；Adapter→Runtime（真实 CLI）
E2E          agent model add → agent run → validator → result
失败测试     agent crash / model timeout / 401 / rate limit / 构建失败
安全测试     越权文件 / 命令 / 网络 / 密钥泄露 / workspace 逃逸
性能测试     吞吐 / 并发 / 延迟 / token / 成本
```

真实 CLI 基线见 TESTING.md §11（Claude / OpenCode / Codex / OpenClaw / Reasonix 均已实测）。

---

# 10. Roadmap 映射

| 组件 | 主要落地阶段 |
|---|---|
| CLI / Daemon / Management API / Task Gateway / Model Registry / SQLite Store | Phase 2（MVP） |
| Router（基础） / Planner（直通） / Scheduler（基础） / Worker / Agent Adapter（Claude+Codex+ACP） | Phase 2 |
| Validator（build/test/lint） | Phase 2 + Phase 7 增强 |
| Workspace Manager（基础副本隔离） | Phase 2 → Phase 5 增强 |
| Security（token/审批门/脱敏） | Phase 2 基线 → 后续增强 |
| Observability（日志/usage） | Phase 2 基线 → Phase 9 增强 |
| Agent Registry 增强 / 连接探测 / 状态标记 | Phase 3 |
| Planner DAG / 分解器 | Phase 4 |
| 并行 Worker / 并发调度 / 完整隔离 | Phase 5 |
| Supervisor 完整策略（重试/升级/取消） | Phase 6 |
| 成本感知路由 / 模型排行 | Phase 8 |
| 指标面板 / 自适应路由 | Phase 9 / 10 |
| WebUI 管理后台 | Phase 11 |

---

# 11. 风险与开放问题

| 风险 / 问题 | 影响 | 缓解 |
|---|---|---|
| MIMO token-plan key 失效（实测 401） | Claude+MIMO 链路不可用 | 注册表由用户管理；探测标记 error，提示用户刷新 |
| Claude 对第三方模型成本估算失真（25K tokens 报 $0.127） | 预算误判 | 成本以 provider usage × 价格表为准（ADR-0014） |
| ACP 生态未成熟 | 适配器工作量不确定 | MVP 手写最小 NDJSON client + 集成测试兜底 |
| daemon 崩溃导致任务悬挂 | 状态不一致 | 启动恢复：running → interrupted |
| 并发写 SQLite | 锁竞争 | 单写者模型（写集中在 daemon）+ WAL |
| WebUI 技术栈未定 | Phase 11 范围 | 复用 /v1 API，随时可换前端 |
