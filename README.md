# I-Evolve

## 中文

I-Evolve 是一个本地优先、由 daemon 协调写入的 Coding Agent 记忆系统。它通过 CLI、Codex 兼容 MCP Server、Claude Code Plugin，让 Codex / Claude Code 等工具共享同一套可审计、可回滚、可跨仓召回的 memory。

## English

I-Evolve is a local-first, daemon-backed memory system for coding agents. It exposes shared memory through CLI commands, a Codex-compatible MCP server, and a Claude Code plugin bundle so Codex / Claude Code can share auditable, rollback-capable, cross-repo memory.

## 快速安装 / Quick Install

### 交互式引导（推荐）/ Guided Setup (Recommended)

中文：如果你已安装 Claude Code 并 clone 了本仓库，可以直接使用 setup skill 完成全部配置：

English: If you have Claude Code installed and have cloned this repo, use the setup skill for a fully guided experience:

```bash
/i-evolve:setup
```

该 skill 会自动引导你完成：环境检测（Node.js/nvm/pnpm）→ 依赖安装 → 构建 → 插件注册 → sync 配置（auto_push + 仓库白名单）→ 向量模型下载 → SQLite 索引初始化 → daemon 启动 → 项目绑定 → 健康检查。

This skill guides you through: environment detection (Node.js/nvm/pnpm) → dependency install → build → plugin registration → sync config (auto_push + repo whitelist) → embedding model download → SQLite index init → daemon start → project binding → health check.

### 手动安装 / Manual Install

```bash
git clone <this-repo-url>
cd I-Evolve
./scripts/install.sh all
```

中文：安装后重启 Codex / Claude Code，然后启动 daemon：

English: After installation, restart Codex / Claude Code, then start the daemon:

```bash
pnpm tsx apps/cli/src/index.ts daemon start
pnpm tsx apps/cli/src/index.ts mcp status
```

## 安装内容 / What Setup Installs

中文：

- Codex MCP 配置：向 `~/.codex/config.toml` 写入 `[mcp_servers.i-evolve]`。
- Claude Code Plugin：复制 `packages/claude-plugin` 到 `~/.claude/plugins/i-evolve`。
- 依赖与构建产物：执行 `pnpm install` 和 `pnpm build`。
- 本地 memory 存储初始化：执行 `i-evolve memory init-local`。

English:

- Codex MCP config: adds `[mcp_servers.i-evolve]` to `~/.codex/config.toml`.
- Claude Code plugin: copies `packages/claude-plugin` to `~/.claude/plugins/i-evolve`.
- Dependencies and build artifacts: runs `pnpm install` and `pnpm build`.
- Local memory storage initialization: runs `i-evolve memory init-local`.

## 分 Agent 安装 / Agent-Specific Setup

Codex only / 仅配置 Codex：

```bash
pnpm tsx apps/cli/src/index.ts setup codex
```

Claude Code only / 仅安装 Claude Code：

```bash
pnpm tsx apps/cli/src/index.ts setup claude-code
```

Preview without writing / 仅预览不写入：

```bash
pnpm tsx apps/cli/src/index.ts setup all --dry-run
```


## 本地召回与 Embedding / Local Retrieval & Embedding

中文：当前实现与召回方案保持以下一致性：Memory 主存储仍然是 Markdown + Git；检索产物（SQLite/FTS、chunk、后续 vector index、query cache）只作为本地派生缓存；`SessionStart` 与 `UserPromptSubmit` 分别用于基线召回和基于用户 prompt 的动态召回；`UserPromptSubmit` 会先做规则式意图推测，再输出 prompt-specific context。

English: The current implementation follows the proposed retrieval design in these areas: Markdown + Git remains the source of truth for Memory; retrieval artifacts (SQLite/FTS, chunks, future vector indexes, and query cache) are local derived state; `SessionStart` and `UserPromptSubmit` are separate baseline and prompt-specific recall phases; and `UserPromptSubmit` performs rule-based intent inference before producing prompt-specific context.

中文：默认 embedding 模型是 **`BAAI/bge-m3`**，runtime 标记为 `FlagEmbedding`，默认维度为 `1024`，设备为 `auto`。轻量备选 profile 是 `intfloat/multilingual-e5-small`（384 维）和 `BAAI/bge-small-zh-v1.5`（512 维）。当前 MVP 命令会写入本地 `model.lock.yaml` 和诊断信息；实际模型下载、真实 dense vector 生成、sqlite-vec/hnswlib 后端、rerank 与 query cache 仍属于后续迭代。

English: The default embedding model is **`BAAI/bge-m3`** with runtime label `FlagEmbedding`, default dimension `1024`, and device `auto`. Lightweight alternatives are `intfloat/multilingual-e5-small` (384 dimensions) and `BAAI/bge-small-zh-v1.5` (512 dimensions). The current MVP command writes local `model.lock.yaml` metadata and diagnostic output; actual model download, dense vector generation, sqlite-vec/hnswlib backends, reranking, and query cache are still future iterations.

常用命令 / Common commands:

```bash
# Install or inspect the default local embedding profile / 安装或查看默认本地 embedding profile
pnpm tsx apps/cli/src/index.ts model install default
pnpm tsx apps/cli/src/index.ts model status
pnpm tsx apps/cli/src/index.ts model list

# Rebuild/check the local derived index / 重建或检查本地派生索引
pnpm tsx apps/cli/src/index.ts index rebuild
pnpm tsx apps/cli/src/index.ts index doctor

# Infer prompt intent and recall context / 推测用户意图并召回上下文
pnpm tsx apps/cli/src/index.ts intent infer --prompt "帮我 review SSR 迁移后的水合问题"
pnpm tsx apps/cli/src/index.ts recall --phase session_start --debug
pnpm tsx apps/cli/src/index.ts recall --phase user_prompt_submit --query "帮我 review SSR 迁移后的水合问题" --debug
```

实现状态 / Implementation status:

| Area | Status |
|---|---|
| Local-only retrieval artifacts | Implemented as local derived runtime state |
| Default embedding profile | `BAAI/bge-m3`, `FlagEmbedding`, 1024 dimensions |
| Intent inference | Implemented with deterministic rules and keywords |
| Memory-aware chunking | Implemented with `header`, `semantic`, and `operational` chunks |
| SessionStart/UserPromptSubmit markdown injection | Implemented |
| Actual embedding model download | Planned |
| Dense vector backend (`sqlite-vec`/`hnswlib`) | Planned |
| Hybrid dense + lexical + rerank scoring | Partially planned; current runtime uses existing FTS/debug retrieval path |

## 验证 / Verify

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
```

中文：详细安装、路径覆盖和排障说明见 [docs/install-codex-claude.md](docs/install-codex-claude.md)。

English: See [docs/install-codex-claude.md](docs/install-codex-claude.md) for detailed installation, custom paths, and troubleshooting.
