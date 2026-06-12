<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# I-Evolve MVP0-8 分阶段实施文档索引

> 版本：v0.3.1  
> 日期：2026-06-12  
> 目标：将 I-Evolve v0.3 总 Spec 拆分为可逐阶段交给 Coding Agent 实施的多份文档。

## 总原则

```text
Git-managed Markdown Memory = 唯一事实源
Daemon = 必选本地运行时和唯一写协调者
SQLite / FTS = 本地派生索引，可删除、可重建
AI Policy Judge = 默认自动审核机制
Git = 版本、同步、审计、回滚基础设施
跨仓 Memory = 通过 repo_id / project_id / domain / applies_to 精确召回
```

## 文档列表

| 文档 | 阶段 | 主题 |
|---|---|---|
| `00-roadmap-and-architecture.md` | 总览 | 总体路线图与架构约束 |
| `01-mvp0-core-schema-and-monorepo.md` | MVP0 | Monorepo、Schema、核心类型 |
| `02-mvp1-daemon-runtime.md` | MVP1 | Daemon 必选运行时 |
| `03-mvp2-markdown-memory-and-sqlite-index.md` | MVP2 | Markdown Memory 与 SQLite/FTS 派生索引 |
| `04-mvp3-ai-auto-evolution-and-audit.md` | MVP3 | AI 自动提炼、审核、审计 |
| `05-mvp4-claude-code-plugin-hooks-skills.md` | MVP4 | Claude Code Plugin / Hooks / Skills |
| `06-mvp5-git-remote-memory-versioning.md` | MVP5 | Git Remote Memory、版本、回滚 |
| `07-mvp6-cross-repo-retrieval-conflict-topk.md` | MVP6 | 跨仓召回、冲突优先级、Top-K |
| `08-mvp7-mcp-multi-client.md` | MVP7 | MCP Server 与多客户端共享 |
| `09-mvp8-dashboard-hardening-release.md` | MVP8 | Dashboard、治理加固、发布 |

## 推荐实施路径

```text
MVP0 → MVP1 → MVP2 → MVP3 → MVP4 → MVP5 → MVP6 → MVP7 → MVP8
```

MVP0-4 打通单机闭环：

```text
Schema → Daemon → Markdown/FTS → AI 自动沉淀 → Claude Code 注入
```

MVP5-8 做产品化增强：

```text
Git 远程同步 → 跨仓防污染 → MCP 多客户端 → Dashboard / Release / Hardening
```
