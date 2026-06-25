---
name: setup
description: End-to-end I-Evolve setup — from git clone through configuration and first run. Covers prerequisites, build, plugin registration, sync config (auto_push, repo whitelist), daemon start, project binding, and health check.
---

# I-Evolve: End-to-End Setup

Guide a user through the complete I-Evolve installation and configuration.
Execute steps sequentially. Stop on failure or when user input is required.

## Step 0: Clone (skip if already in the repo)

If not already inside the I-Evolve repo:

```bash
git clone https://github.com/MoMeak9/I-Evolve.git
cd I-Evolve
```

## Step 1: Prerequisites

Check Node.js and pnpm:

```bash
command -v node && node --version
command -v pnpm && pnpm --version
```

### If Node.js is missing or below v20:

Install nvm first, then use it to install Node.js:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Load nvm into current shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install and use Node.js 20
nvm install 20
nvm use 20
```

Verify after installation:
```bash
node --version  # should be v20.x+
```

### If pnpm is missing:

```bash
npm install -g pnpm@9
```

## Step 2: Install & Build

```bash
pnpm install
pnpm build
```

If build fails, run `pnpm typecheck` to surface errors and stop.

## Step 3: Register Plugin

```bash
pnpm tsx apps/cli/src/index.ts setup all --project-root .
```

This registers:
- Claude Code plugin (skills + hooks) → `~/.claude/plugins/i-evolve/`
- MCP server config (Codex)

## Step 4: Configure Sync Settings

The config file lives at `~/.i-evolve/shared/memory/memory-pack.yaml`.

Ask the user these questions:

1. **Repo whitelist** — Which repos should trigger auto-push when their memories are promoted?
   - Format: short repo directory names (e.g. `app-kntr`, `MoMeak9-I-Evolve`)
   - Empty list = no auto-push happens (safety default)
   - `*` = push for all repos (not recommended for multi-repo setups)

Then write the config:

```bash
mkdir -p ~/.i-evolve/shared/memory
cat > ~/.i-evolve/shared/memory/memory-pack.yaml << 'EOF'
id: team.default
schema_version: 1
sync:
  auto_push: true
  push_repos:
    - <repo-name-1>
    - <repo-name-2>
EOF
```

Replace placeholders with user's answers.

**Alternatively**, the user can set the env var `IEVOLVE_PUSH_REPOS` (comma-separated) which overrides the yaml whitelist at runtime.

## Step 5: Embedding Model

Ask the user whether to download the local embedding model now.

Available profiles:
- `lite` — `Xenova/multilingual-e5-small` (384d, ~90MB, fast)
- `default` — `Xenova/bge-m3` (1024d, ~400MB, highest quality)
- `chinese_lite` — `Xenova/bge-small-zh-v1.5` (512d, ~90MB, Chinese optimized)

Recommend `lite` for quick setup. If user agrees to download:

```bash
pnpm tsx apps/cli/src/index.ts model install lite
```

If the user is in China and HuggingFace is blocked, suggest setting a mirror:
```bash
export HF_ENDPOINT=https://hf-mirror.com
pnpm tsx apps/cli/src/index.ts model install lite
```

If the user declines, skip — the model will be downloaded on first use.
Without a model, vector search is unavailable but FTS still works.

## Step 6: Initialize SQLite Index

The SQLite database is auto-created on first daemon start at `~/.i-evolve/index.db`.
Verify it was created and bootstrap the index from existing memory files:

```bash
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
```

This will:
- Create SQLite DB if missing (with FTS5 + vector tables)
- Scan `~/.i-evolve/shared/memory/` and index all existing memories
- Report indexed count

If SQLite native binding fails (rare, e.g. architecture mismatch):
```bash
cd node_modules/better-sqlite3 && npx prebuild-install || npm run build-release
```

## Step 7: Start Daemon

```bash
pnpm tsx apps/cli/src/index.ts daemon start
```

If it fails, try:
```bash
pnpm tsx apps/cli/src/index.ts daemon stop
pnpm tsx apps/cli/src/index.ts daemon start
```

## Step 8: Bind Project Identity

Detect the current repo:

```bash
pnpm tsx apps/cli/src/index.ts identity detect
```

Present detected `project-id`, `domain`, and `git-remote` to the user.
Ask them to confirm or override, then apply:

```bash
pnpm tsx apps/cli/src/index.ts init --yes --project <id> --domain <domain> --remote <remote>
```

If user wants local-only memory (no shared remote), use `--skip-remote`.

## Step 9: Health Check

```bash
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
pnpm tsx apps/cli/src/index.ts mcp status
```

## Done

Show summary:

```
[1/9] Clone           — done
[2/9] Prerequisites   — node <ver>, pnpm <ver>
[3/9] Build           — success
[4/9] Plugin          — registered
[5/9] Sync config     — auto_push: true, repos: [app-kntr, ...]
[6/9] Embedding model — <profile> installed (or skipped)
[7/9] SQLite index    — <n> memories indexed
[8/9] Daemon          — running
[9/9] Project bound   — <project-id> @ <domain>

Health check: passed

→ Restart Claude Code to activate hooks and skills.
```

## Error Recovery

| Problem | Fix |
|---------|-----|
| `pnpm install` network failure | `pnpm install --offline` or retry |
| `pnpm build` type errors | `pnpm typecheck` for details |
| Daemon won't start | `daemon stop` then `daemon start` |
| Doctor fails | Show output, retry daemon restart |
| Plugin not detected after restart | Verify `~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` exists |
