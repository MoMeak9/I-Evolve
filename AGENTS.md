# Codex Project Instructions

I-Evolve should be used through MCP so Codex can access the shared daemon-backed memory and tools.

## Setup

Run this from the repository root:

```bash
pnpm tsx apps/cli/src/index.ts setup codex
```

## Verification

Start the I-Evolve daemon, then confirm MCP connectivity:

```bash
pnpm tsx apps/cli/src/index.ts daemon start
pnpm tsx apps/cli/src/index.ts mcp status
```

## More information

See `docs/install-codex-claude.md` for the full Codex and Claude Code installation guide.
