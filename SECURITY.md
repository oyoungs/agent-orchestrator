# SECURITY.md

# Security Model

本系统属于高权限 Agent Orchestrator。

Agent 可能访问：

```text
Filesystem
Shell
Git
Network
Browser
Credentials
```

因此安全模型必须从 MVP 开始考虑。

---

# 1. Principle of Least Privilege

默认：

```text
Deny
```

只有任务明确需要时才：

```text
Allow
```

---

# 2. Permission Categories

```text
Filesystem Read
Filesystem Write
Shell Execute
Network
Git
Browser
Secrets
```

---

# 3. Workspace Isolation

Agent 默认只能访问自己的 Workspace。

---

# 4. Secret Isolation

不要将：

```text
API Key
Token
Password
SSH Key
Cookie
```

直接放入 Prompt。

---

# 5. Shell Execution

Shell 命令必须考虑：

```text
Allowlist
Denylist
Sandbox
Timeout
Resource Limit
```

具体策略必须在实现前进一步讨论。

---

# 6. Network

需要区分：

```text
No Network
Restricted Network
Full Network
```

---

# 7. Human Approval

对于高风险动作，考虑：

```text
Agent
 ↓
Proposed Action
 ↓
Policy
 ↓
Human Approval
 ↓
Execute
```

---

# 8. Security Priority

安全问题优先于：

```text
Convenience
Performance
Cost
Automation
```

