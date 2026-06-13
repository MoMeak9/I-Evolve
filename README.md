# I-Evolve

I-Evolve is a local-first, daemon-backed memory system for coding agents. It exposes shared memory through CLI commands, a Codex-compatible MCP server, and a Claude Code plugin bundle.

## Quick Install

```bash
git clone <this-repo-url>
cd I-Evolve
./scripts/install.sh all
```

Then restart Codex / Claude Code and start the daemon:

```bash
pnpm tsx apps/cli/src/index.ts daemon start
pnpm tsx apps/cli/src/index.ts mcp status
```

## What Setup Installs

- Codex MCP config: adds `[mcp_servers.i-evolve]` to `~/.codex/config.toml`.
- Claude Code plugin: copies `packages/claude-plugin` to `~/.claude/plugins/i-evolve`.
- Project dependencies and build artifacts through `pnpm install` and `pnpm build`.
- Local memory storage initialization through `i-evolve memory init-local`.

## Agent-Specific Setup

Codex only:

```bash
pnpm tsx apps/cli/src/index.ts setup codex
```

Claude Code only:

```bash
pnpm tsx apps/cli/src/index.ts setup claude-code
```

Preview without writing:

```bash
pnpm tsx apps/cli/src/index.ts setup all --dry-run
```

## Verify

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
```

See [docs/install-codex-claude.md](docs/install-codex-claude.md) for detailed installation and troubleshooting.
