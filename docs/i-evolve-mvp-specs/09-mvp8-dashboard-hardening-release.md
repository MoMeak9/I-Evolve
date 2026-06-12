<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 09. MVP8：Dashboard、治理加固与发布工程

> 目标：将 I-Evolve 从可用工具推进到可维护、可解释、可回滚、可分发的产品化系统。  
> 非目标：不改变 Markdown/Git 主存储原则，不绕过 Daemon。

## 1. 交付目标

```text
- Dashboard 查看 Memory、Audit、Conflicts、Daemon、Git 状态。
- 可视化回滚和 forget。
- doctor / audit / validate / repair 完整化。
- release pipeline 和版本策略。
- 污染测试、安全测试、回归测试完善。
```

## 2. Dashboard 范围

```text
apps/dashboard/
  src/
    pages/
      Memories.tsx
      MemoryDetail.tsx
      Audit.tsx
      Conflicts.tsx
      DaemonStatus.tsx
      GitStatus.tsx
      Settings.tsx
    api/
      daemonClient.ts
```

Dashboard 只连接本地 daemon。

禁止：

```text
- Dashboard 直接读写 Markdown。
- Dashboard 直接操作 Git。
- Dashboard 绕过 daemon transaction。
```

## 3. 页面设计

### Memories

```text
- 列表查看 active / rejected / deprecated / superseded。
- 按 scope / project / repo / domain 过滤。
- 搜索 Memory。
- 查看 confidence、expires_at、revision。
```

### Memory Detail

```text
- 查看 Markdown 内容。
- 查看 frontmatter。
- 查看 audit timeline。
- 查看 source_refs。
- 查看注入历史。
- 执行 deprecate / forget / rollback。
```

### Audit

```text
- 查看 AI 自动审核记录。
- 查看 policy checks。
- 查看被 reject 的候选。
- 查看 scope_downgrade 原因。
```

### Conflicts

```text
- 查看冲突规则。
- 查看被抑制的 Memory。
- 查看选择原因。
```

### Daemon / Git Status

```text
- daemon uptime。
- transaction success/failure。
- index health。
- current commit。
- remote branch。
- dirty files。
- unpushed commits。
- last pull time。
```

## 4. Daemon API for Dashboard

```text
GET /health
GET /memories
GET /memories/:id
GET /audit
GET /conflicts
POST /memories/:id/forget
POST /memories/:id/deprecate
POST /memories/:id/rollback
GET /git/status
POST /git/pull
POST /git/push
POST /index/rebuild
```

如果不提供 HTTP，也可以通过本地 IPC bridge。

## 5. Doctor 完整化

```bash
i-evolve doctor
```

检查：

```text
[ ] CLI version
[ ] daemon running
[ ] local directory
[ ] memory repo exists
[ ] git status clean
[ ] schema version
[ ] sqlite health
[ ] fts health
[ ] audit log health
[ ] Claude plugin installed
[ ] MCP server status
[ ] remote memory status
```

## 6. Repair 命令

```bash
i-evolve repair stale-lock
i-evolve repair rebuild-index
i-evolve repair verify-hashes
i-evolve repair audit-log
i-evolve repair git-cleanup
```

规则：

```text
- repair 必须尽量可 dry-run。
- repair 不能静默删除 Memory。
- repair 需要写 system audit。
```

## 7. 安全加固

```text
- Git push 前检查 secret / PII。
- Memory create 前检查 secret / PII。
- AI candidate approve 前检查 secret / PII / scope leakage。
- 外部 AI Provider 必须显式 opt-in。
- sensitive observation 不外发。
- rawRef 不外发。
```

## 8. 发布策略

代码版本：

```text
i-evolve-cli@0.3.1
i-evolve-daemon@0.3.1
i-evolve-core@0.3.1
i-evolve-mcp-server@0.3.1
i-evolve-claude-plugin@0.3.1
```

Memory 版本：

```text
i-evolve-memory Git tag: memory-2026.06.12
```

原则：

```text
代码版本和 Memory 内容版本不绑定。
schema_version 通过 migration 管理。
Git commit 是 Memory 精确版本。
```

## 9. Release Checklist

```text
[ ] pnpm build
[ ] pnpm test
[ ] pnpm typecheck
[ ] schema fixtures pass
[ ] integration tests pass
[ ] pollution tests pass
[ ] security checks pass
[ ] migration dry-run pass
[ ] npm package dry-run pass
[ ] Claude plugin package pass
[ ] MCP server smoke test pass
```

## 10. 污染测试

```text
[ ] task constraint 不会提升为 global。
[ ] rejected memory 不会再次高频生成。
[ ] deprecated memory 不会被注入。
[ ] repo A memory 不会注入 repo B。
[ ] domain memory 可以跨相关 repo 注入。
[ ] Git rollback 后 SQLite/index 能重建。
[ ] AI 自动审核有 audit action。
[ ] secret / PII / internal path 不会进入 shared memory。
[ ] 同一 memory 并发修改会触发 revision conflict。
[ ] daemon 未启动时写操作失败。
```

## 11. E2E 场景

### 单仓闭环

```text
1. 启动 daemon。
2. 初始化 memory repo。
3. Claude Code SessionStart inject。
4. PostToolUse observe。
5. Stop finalize。
6. AI 自动生成 active memory。
7. 下一次 SessionStart 注入该 memory。
```

### 跨仓召回

```text
1. 在 repo A 生成 domain memory。
2. 切换到 repo B。
3. repo B 匹配 same domain。
4. domain memory 被注入。
5. repo A 特有 memory 不注入。
```

### 回滚

```text
1. 生成错误 memory。
2. Git commit。
3. 通过 Dashboard rollback。
4. index rebuild。
5. inject 不再出现错误 memory。
```

## 12. 验收清单

```text
[ ] Dashboard 可查看 Memory。
[ ] Dashboard 可查看 Audit。
[ ] Dashboard 可查看 Git / Daemon 状态。
[ ] Dashboard 可执行 forget / deprecate / rollback。
[ ] doctor / repair 完整可用。
[ ] release checklist 可跑通。
[ ] 污染测试覆盖核心风险。
[ ] 安全检查覆盖 secret / PII / scope leakage。
[ ] 项目具备发布 npm 包和插件包能力。
```
