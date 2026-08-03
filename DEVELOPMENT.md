# DEVELOPMENT.md

# Development Guide

## 1. Before Coding

必须：

```text
Read AGENTS.md
Read SPEC.md
Read ARCHITECTURE.md
Read ROADMAP.md
Read DECISIONS.md
```

然后：

```text
Inspect Repository
Inspect Environment
Inspect Dependencies
Inspect Existing Code
```

---

# 2. Before Architecture Changes

如果改变：

```text
Core Interface
Data Model
Scheduler
Worker
Agent Adapter
Model Adapter
Persistence
Security
```

必须先说明：

```text
Why
Alternatives
Impact
Migration
```

必要时记录 ADR。

---

# 3. Before Implementation

明确：

```text
Task
Files
Interfaces
Tests
Validation
```

---

# 4. Implementation

遵循：

```text
Small Change
↓
Test
↓
Review
↓
Next Change
```

不要一次修改大量无关文件。

---

# 5. Testing

每一个功能至少考虑：

```text
Unit
Integration
Failure
Edge Case
```

重要功能增加：

```text
E2E
```

---

# 6. External Agent Testing

如果测试 Agent Runtime：

必须尽可能真实测试：

```text
CLI
Exit Code
Input
Output
Streaming
Timeout
Cancellation
Error
```

不要只 Mock 所有东西。

---

# 7. Model Testing

需要考虑：

```text
Latency
Cost
Availability
Failure
Rate Limit
Context
Tool Calling
```

---

# 8. Documentation

代码发生重要变化时同步更新：

```text
README
SPEC
ARCHITECTURE
DECISIONS
```

---

# 9. Completion Criteria

不能只说：

```text
Implemented
```

必须说明：

```text
Implemented
Tested
Validated
Known Limitations
```

