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

