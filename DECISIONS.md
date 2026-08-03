# Architecture Decision Records

本文档记录重要架构决策。

原则：

> 任何影响系统长期结构的重要决策，都应该记录原因，而不仅仅记录结果。

状态说明：`Proposed`（提案）→ `Accepted`（已确认）→ `Deprecated`（已废弃）。

---

## ADR-0001 Project Scope

### Status

Accepted (2026-08-03)

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

Accepted (2026-08-03)

### Decision

Agent Runtime 和 Model 必须解耦。

### Reason

允许 OpenCode + DeepSeek、Codex + MIMO、Claude Code + DeepSeek 等组合动态存在。

### Verified (2026-08-03)

五种 Runtime 均实测支持外部模型选择：

| Runtime | 模型选择方式 | 实测结果 |
|---|---|---|
| Claude Code | `--settings <file>` / `--model` | DeepSeek ✓；MIMO token-plan ✗（401，key 失效） |
| OpenCode | `-m provider/model` | deepseek-v4-flash-free ✓、mimo-v2.5-free ✓（$0） |
| Codex | `exec -m <model>` | deepseek-v4-flash ✓ |
| OpenClaw | `agent --model provider/model` | deepseek-v4-flash ✓ |
| Reasonix | `run -m <model>` | deepseek-v4-flash ✓（$0.0004） |

---

## ADR-0003 Free-first Routing

### Status

Accepted (2026-08-03)

### Decision

默认优先选择满足能力要求的最低成本模型。

不是简单的 `FREE > PAID`，而是综合：

```text
Capability + Reliability + Cost + Latency
```

### Reason

降低总体推理成本。

---

## ADR-0004 Parallel Execution

### Status

Accepted (2026-08-03)

### Decision

没有依赖和资源冲突的 Task 可以并行。

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

Accepted (2026-08-03)

### Decision

采用混合隔离策略（细化见 ADR-0009）：

- 目标项目是 git 仓库 → 每 Worker 一个 Git Worktree；
- 目标项目不是 git 仓库 → 每 Worker 独立目录副本，完成后 diff/apply 合并。

### Context

2026-08-03 环境调查：本机 `~/Documents/workspace/.git` 是 Mimo Code 项目标记而非真实仓库；`agent-orchestrator` 初始也不是 git 仓库（已于当日 `git init`）。纯 Git Worktree 方案在此类环境无法落地。

---

## ADR-0006 Primary Language & Runtime

### Status

Accepted (2026-08-03)

### Decision

TypeScript + Node.js（本机 v26.0.0），包管理用 pnpm。

### Alternatives

```text
A. Python 3.14 (asyncio)
B. Go
C. Rust
```

### Reason

- 所有目标 Agent CLI 均为 Node 生态，进程管理、JSON/JSONL 流解析、MCP SDK 生态最顺；
- 本机已有 Node 26 / pnpm / bun，零额外运行时安装；
- 快速迭代优先于极致性能（MVP 目标）。

### Consequences

- 单进程事件循环 + Worker 进程组即可支撑高并发编排；
- 未来若出现性能热点，可在边界处用 Go/Rust 替换，核心接口不受影响。

---

## ADR-0007 Persistence & Queue

### Status

Accepted (2026-08-03)

### Decision

SQLite（better-sqlite3）+ 进程内任务队列；MVP 不引入外部队列 / 事件总线。

### Reason

- 本地单机、零运维，直接支撑任务/成本/指标记录（FR-011/012）；
- OpenCode / OpenClaw 均使用 SQLite，生态一致；
- PostgreSQL / Redis 对 MVP 是过度设计。

### Consequences

- 采用单写者模型：写库集中在调度进程内；
- 未来需要多机执行时再替换为外部队列，存储层先做接口抽象。

---

## ADR-0008 MVP Task Scope & CLI

### Status

Accepted (2026-08-03)

### Decision

MVP 只处理 coding 类任务（重构 / 测试 / 修复 / 审查）；CLI 提供：

```text
agent run <task>
agent status
```

### Reason

收敛 Router 分类器与 Validator 集合，最快打通最小链路。

### Consequences

- `agent run "<task>"` 是唯一任务入口；
- plan / cost / metrics 等命令按 ROADMAP 后续增加，CLI 预留子命令骨架。

---

## ADR-0009 Workspace Isolation Strategy

### Status

Accepted (2026-08-03)

### Decision

混合隔离：

```text
有 git 仓库  → git worktree add worker-<id>
无 git 仓库 → cp -R 目录副本
              → Worker 执行
              → diff -ruN 生成补丁
              → 人工确认后 apply
```

MVP 不使用容器沙箱（colima / podman 当前未运行，资源开销大）。

### Alternatives

```text
A. 强制 git + worktree
B. 纯目录副本
C. 容器 / 虚拟机沙箱
```

### Reason

环境事实决定：纯 worktree 无法覆盖非仓库项目；容器方案当前不可用。

---

## ADR-0010 MVP Security Boundary

### Status

Accepted (2026-08-03)

### Decision

MVP 复用各 Runtime 原生权限机制 + 统一高风险动作人工确认：

| Runtime | 原生权限机制 |
|---|---|
| Claude Code | `--permission-mode`（plan / acceptEdits / manual） |
| Codex | `--sandbox read-only|workspace-write` + 审批 |
| OpenCode | 配置级 allow / deny |
| Reasonix | 项目级 shellAllowed |
| OpenClaw | approvals / exec-policy |

自研策略引擎与系统级沙箱放到后续阶段。

### Reason

每个 Runtime 已验证支持原生权限，最快满足 SECURITY.md「安全从 MVP 开始」的要求；自研策略引擎会显著拉长 MVP。

### Consequences

- 安全边界 = Runtime 原生能力 ∪ 统一人工确认门；
- Deny-by-default 由 Runtime 层落实，Orchestrator 层记录审计日志。

---

## ADR-0011 Agent Adapter Protocol

### Status

Accepted (2026-08-03)

### Decision

ACP-first 混合架构：

```text
OpenCode / OpenClaw / Reasonix  → ACP（stdio NDJSON JSON-RPC）
Claude Code / Codex             → 专用进程适配器
```

统一 `AgentAdapter` 接口，ACP 只是其中一种实现。

### Context

环境调查确认 ACP 支持矩阵：

| Runtime | ACP | 原生非交互 |
|---|---|---|
| Claude Code | ✗ | `-p` + json / stream-json |
| OpenCode | ✓ `opencode acp` | `run --format json`（JSONL） |
| Codex | ✗ | `exec --json`（JSONL） |
| OpenClaw | ✓ `openclaw acp` | `agent --json` |
| Reasonix | ✓ `reasonix acp` | `run`（流式） |

### Reason

复用标准协议减少适配代码，同时保留 Claude / Codex 的成熟 CLI 能力。

---

## ADR-0012 Model Adapter Protocol

### Status

Accepted (2026-08-03)

### Decision

Model Adapter 以 OpenAI 兼容协议为主：

```text
DeepSeek / MIMO (mimox, xiaomi) / MiniMax → OpenAI 兼容
Codex                                     → Responses wire API
Claude Code                               → Anthropic 兼容端点（--settings / env 注入）
```

### Context

实测：DeepSeek 同时提供 Anthropic 兼容端点（`api.deepseek.com/anthropic`）与 OpenAI / Responses 端点；MiniMax 提供 OpenAI 兼容与 Anthropic 兼容端点。

---

## ADR-0013 Configuration Format

### Status

Accepted (2026-08-03)

### Decision

统一 TOML 配置（项目根 `agent-orchestrator.toml`，用户级 `~/.agent-orchestrator/config.toml`）。

### Reason

Codex 已使用 TOML；TOML 比 JSON 更适合人类编辑与注释；结构明确、易校验。

---

## ADR-0014 Observability & Cost Accuracy

### Status

Accepted (2026-08-03)

### Decision

- 结构化 JSONL 日志（task / worker / supervisor / validation 事件流）；
- 指标与成本写入 SQLite（FR-011/012）；
- **不信任 Agent 上报的成本估算**，以 Provider 返回的 usage × 配置价格表为准。

### Context

实测发现：Claude Code 对第三方模型（deepseek-v4-flash[1m]）的成本估算明显失真——25,203 input + 35 output tokens 上报 $0.127，而按 DeepSeek 实际价格约为 $0.004；且 `--max-budget-usd` 基于该估算，可能误触发。

### Consequences

- 成本记录字段 = provider / model / input_tokens / output_tokens / cache_read / cache_write / reasoning_tokens × unit_price；
- Agent 返回的 cost 字段仅作参考，不进入正式统计。

---

## ADR-0015 Runtime Verification Baseline

### Status

Accepted (2026-08-03)

### Decision

以 2026-08-03 实测结果作为能力基线（详见 TESTING.md「外部 Agent 实测记录」）。

### Context

- 5/5 Runtime 非交互链路可用；
- MIMO token-plan（Claude Code 接入）当前 401 Invalid API Key，需用户刷新 token；
- 免费模型梯队已实测：`opencode/deepseek-v4-flash-free`、`opencode/mimo-v2.5-free`；
- 本地 oMLX / Ollama 服务未运行。

---

# Future ADRs

后续记录：

```text
ADR-xxxx Scheduler Policy
ADR-xxxx Router Policy
ADR-xxxx Validator Policy
ADR-xxxx Merge Strategy
ADR-xxxx Sandbox
ADR-xxxx Orchestrator MCP / SDK
```
