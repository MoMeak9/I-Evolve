<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 08. MVP7：MCP Server 与多客户端共享

> 目标：通过 MCP Server 让 Claude Desktop、Cursor、Codex、其他 Agent 共享同一套 I-Evolve Memory。  
> 非目标：MCP 不直接写 Markdown，不绕过 Daemon。

## 1. 交付目标

```text
Claude Code 通过 Hooks 使用 I-Evolve。
Cursor / Codex / Claude Desktop 通过 MCP 使用 I-Evolve。
所有客户端共享同一个 daemon 和同一套 Memory。
```

架构：

```text
MCP Client
→ i-evolve-mcp-server
→ daemon IPC
→ Repository Layer
→ Markdown Memory / SQLite Index
```

## 2. 目录结构

```text
apps/mcp-server/
  src/server.ts
  src/tools/
    recall.ts
    remember.ts
    forget.ts
    searchMemory.ts
    auditMemory.ts
    explainMemory.ts
    syncMemory.ts
  src/daemon-client.ts
```

## 3. MCP Server 运行方式

```bash
i-evolve mcp start
i-evolve mcp start --stdio
i-evolve mcp status
```

MCP server 启动时必须检查 daemon：

```text
1. daemon running → 正常启动。
2. daemon not running → 返回错误，提示先启动 daemon。
```

## 4. MCP Tools

### recall

输入：

```json
{
  "query": "SSR 水合审查",
  "cwd": "/path/to/repo",
  "maxTokens": 2000
}
```

输出：

```json
{
  "context": "# I-Evolve Context...",
  "memories": [
    {
      "id": "project.xxx",
      "scope": "project",
      "confidence": 0.91,
      "reason": "project_id matched"
    }
  ]
}
```

### remember

```text
MCP remember
→ daemon
→ candidate memory
→ AI policy judge
→ active/rejected
→ audit
```

### forget

```json
{
  "memoryId": "project.xxx",
  "mode": "soft"
}
```

### search_memory / audit_memory / explain_memory / sync_memory

用于搜索、审计解释和触发同步。

## 5. 权限与安全

MVP7 简化：

```text
- MCP server 只允许本机访问。
- 不暴露公网 HTTP。
- 通过 daemon socket 通信。
- 所有写操作仍走 transaction。
```

## 6. 多客户端并发

场景：

```text
Cursor 通过 MCP remember。
Claude Code Stop hook 同时 auto-evolve。
CLI 同时 memory forget。
```

要求：

```text
- daemon transaction 串行化冲突写。
- Memory revision 冲突返回标准错误。
- MCP 返回可读错误。
```

## 7. MCP Response 原则

```json
{
  "ok": true,
  "data": {},
  "warnings": [],
  "auditId": "audit.xxx"
}
```

错误：

```json
{
  "ok": false,
  "error": {
    "code": "ERR_DAEMON_NOT_RUNNING",
    "message": "I-Evolve daemon is not running."
  }
}
```

## 8. 测试

```text
[ ] daemon 未运行时 MCP 启动失败。
[ ] recall tool 可返回 context。
[ ] remember tool 可触发 candidate → active。
[ ] forget tool 可 soft forget。
[ ] search_memory 可搜索 FTS。
[ ] explain_memory 可返回 audit 信息。
[ ] MCP 与 CLI 并发更新同一 memory 触发 revision conflict。
```

## 9. 验收清单

```text
[ ] MCP server 可启动。
[ ] MCP 通过 daemon 访问 repository。
[ ] recall / remember / forget / search / audit / explain 可用。
[ ] 多客户端共享同一 Memory。
[ ] MCP 不绕过 daemon 写存储。
[ ] 并发冲突可被 daemon 识别。
```
