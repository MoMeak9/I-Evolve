# I-Evolve

## 中文

I-Evolve 是一个本地优先、由 daemon 协调写入的 Coding Agent 记忆系统。它通过 CLI、Codex 兼容 MCP Server、Claude Code Plugin，让 Codex / Claude Code 等工具共享同一套可审计、可回滚、可跨仓召回的 memory。

## English

I-Evolve is a local-first, daemon-backed memory system for coding agents. It exposes shared memory through CLI commands, a Codex-compatible MCP server, and a Claude Code plugin bundle so Codex / Claude Code can share auditable, rollback-capable, cross-repo memory.

## 快速安装 / Quick Install

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

## 验证 / Verify

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
```

中文：详细安装、路径覆盖和排障说明见 [docs/install-codex-claude.md](docs/install-codex-claude.md)。

English: See [docs/install-codex-claude.md](docs/install-codex-claude.md) for detailed installation, custom paths, and troubleshooting.
