# CLAUDE.md

## First-Time Setup

If I-Evolve is not yet installed (no `~/.claude/plugins/i-evolve/` directory), read and execute the setup skill at `packages/claude-plugin/skills/setup/SKILL.md` — it covers everything from Node.js/nvm installation through daemon start and health check.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## CLI (source checkout)

```bash
pnpm tsx apps/cli/src/index.ts <command>
```

## Key Paths

- Plugin skills/hooks: `packages/claude-plugin/`
- Daemon: `packages/daemon/`
- MCP Server: `apps/mcp-server/`
- Memory storage: `~/.i-evolve/shared/memory/`
- Sync config: `~/.i-evolve/shared/memory/memory-pack.yaml`
- SQLite index: `~/.i-evolve/index.db`
- Embedding models: `~/.i-evolve/models/`
