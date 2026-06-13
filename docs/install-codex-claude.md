# Install I-Evolve For Codex And Claude Code

This guide installs I-Evolve so Codex and Claude Code can use the same local daemon-backed memory.

## Requirements

- Node.js 20+
- pnpm 9+
- Git

## One-Command Setup

```bash
cd /path/to/I-Evolve
./scripts/install.sh all
```

The script runs:

```bash
pnpm install
pnpm build
pnpm tsx apps/cli/src/index.ts setup all --project-root /path/to/I-Evolve
```

## Codex

Setup command:

```bash
pnpm tsx apps/cli/src/index.ts setup codex
```

It updates `~/.codex/config.toml` with:

```toml
[mcp_servers.i-evolve]
command = "pnpm"
args = [
  "--dir",
  "/path/to/I-Evolve",
  "tsx",
  "apps/cli/src/index.ts",
  "mcp",
  "start",
  "--stdio"
]
startup_timeout_sec = 30
```

Restart Codex after setup. Start the daemon before using MCP tools:

```bash
pnpm tsx apps/cli/src/index.ts daemon start
pnpm tsx apps/cli/src/index.ts mcp status
```

Available MCP tools:

- `recall`
- `remember`
- `forget`
- `search_memory`
- `audit_memory`
- `explain_memory`
- `sync_memory`

## Claude Code

Setup command:

```bash
pnpm tsx apps/cli/src/index.ts setup claude-code
```

It copies the plugin bundle to:

```text
~/.claude/plugins/i-evolve
```

Installed plugin contents:

- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `skills/init/SKILL.md`
- `skills/remember/SKILL.md`
- `skills/forget/SKILL.md`
- `skills/audit/SKILL.md`
- `skills/explain-memory/SKILL.md`

Restart Claude Code after setup so hooks and skills are loaded.

## Project Identity

Bind a repository to a stable project identity:

```bash
pnpm tsx apps/cli/src/index.ts identity bind --project my-project --domain my-domain
```

This writes a `project-profile.md` file in the memory store.

## Health Check

```bash
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
pnpm tsx apps/cli/src/index.ts mcp status
```

Expected:

- daemon running
- memory repo exists
- SQLite/FTS available
- MCP server ready
- Claude plugin present in the source tree

## Dry Run

Preview all file writes:

```bash
pnpm tsx apps/cli/src/index.ts setup all --dry-run
```

Use custom paths in tests or managed environments:

```bash
pnpm tsx apps/cli/src/index.ts setup codex \
  --codex-config /tmp/codex/config.toml \
  --project-root /path/to/I-Evolve

pnpm tsx apps/cli/src/index.ts setup claude-code \
  --claude-plugin-dir /tmp/claude/plugins/i-evolve \
  --project-root /path/to/I-Evolve
```

## Troubleshooting

If Codex does not show I-Evolve tools:

1. Confirm `~/.codex/config.toml` contains `[mcp_servers.i-evolve]`.
2. Restart Codex.
3. Start the daemon: `pnpm tsx apps/cli/src/index.ts daemon start`.
4. Check MCP status: `pnpm tsx apps/cli/src/index.ts mcp status`.

If Claude Code skills do not appear:

1. Confirm `~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` exists.
2. Restart Claude Code.
3. Run the `init` skill or manually run `i-evolve doctor --bootstrap`.
