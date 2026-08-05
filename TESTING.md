# TESTING.md

# Testing Strategy

## 1. Testing Pyramid

```text
          E2E
        /     \
   Integration
      /       \
     Unit Tests
```

---

# 2. Unit Tests

测试：

```text
Router
Planner
DAG
Scheduler
Registry
Policy
Cost Calculation
```

---

# 3. Integration Tests

测试：

```text
Router → Agent
Agent → Model
Worker → Workspace
Worker → Validator
Scheduler → Worker
Supervisor → Worker
```

---

# 4. E2E Tests

至少模拟：

```text
User
 ↓
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
Agent
 ↓
Model
 ↓
Validator
 ↓
Result
```

---

# 5. Failure Tests

主动测试：

```text
Agent Crash
Model Timeout
Model API Error
Invalid Model Response
Agent CLI Failure
Worker Timeout
Git Conflict
Build Failure
Test Failure
Network Failure
```

---

# 6. Routing Tests

验证：

```text
Free Model
↓
Task
↓
Success
```

以及：

```text
Free Model
↓
Failure
↓
Escalation
↓
Paid Model
↓
Success
```

---

# 7. Parallel Tests

验证：

```text
Task A ─┐
Task B ─┼── parallel
Task C ─┘
```

以及：

```text
Task A
 ↓
Task B
 ↓
Task C
```

---

# 8. Workspace Tests

验证多个 Worker：

```text
Worker A
Worker B
Worker C
```

不会破坏彼此 Workspace。

---

# 9. Security Tests

验证：

```text
Unauthorized File
Unauthorized Command
Unauthorized Network
Secret Exposure
Workspace Escape
```

---

# 10. Performance Tests

关注：

```text
Task Throughput
Worker Concurrency
Latency
Token Usage
Cost
```

---

# 11. 外部 Agent 实测记录（2026-08-03）

真实环境冒烟测试（非 Mock），作为能力基线：

| Runtime | 命令形态 | 模型 | 结果 | 备注 |
|---|---|---|---|---|
| Claude Code | `claude -p --output-format json --settings <file>` | deepseek-v4-flash[1m] | ✓ | 成本估算失真（$0.127 / 25K tokens），见 ADR-0014 |
| Claude Code | 同上（默认 settings） | mimo-v2.5-pro (token-plan) | ✗ 401 | key 失效，需刷新 |
| OpenCode | `opencode run --format json` | opencode/deepseek-v4-flash-free | ✓ | cost=0，JSONL 事件含 tokens/cost |
| OpenCode | 同上 | opencode/mimo-v2.5-free | ✓ | cost=0 |
| Codex | `codex exec --json -m deepseek-v4-flash` | deepseek-v4-flash | ✓ | JSONL：thread/turn/item + usage |
| OpenClaw | `openclaw agent --json --agent main` | deepseek/deepseek-v4-flash | ✓ | usage 完整，sandbox 当前 off |
| Reasonix | `reasonix run -m deepseek-v4-flash` | deepseek-v4-flash | ✓ | cost $0.0004，摘要含 cost |

要点：

```text
Claude Code 401 会重试 11 次 → 适配器必须设置进程级硬超时
成本统计以 provider usage × 配置价格为准，不信任 Agent 上报 cost
所有适配器必须解析结构化输出（json / jsonl），并单独记录 exit code
```

---

# 12. Model Registry & Management Tests

覆盖用户管理的模型生命周期（ADR-0016/0017）：

```text
初始状态      新项目注册表为空
添加模型      计费方式、支持能力、连接信息正确落库
更新模型      价格 / 能力 / 状态修改生效
移除模型      含 API 失效场景（忘记续费）
禁用 / 启用   状态切换且不影响注册记录
连接探测      无效 key → error 状态，可选人工处理
鉴权          无 token 调用 Management API 被拒绝
审计          model_change_log 记录每次变更
并发         并发增删不产生脏数据
```
