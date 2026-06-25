---
name: setup
description: End-to-end I-Evolve setup — from git clone through configuration and first run. Covers prerequisites, build, plugin registration, sync config (auto_push, repo whitelist), daemon start, project binding, and health check.
---

# I-Evolve: End-to-End Setup

Guide a user through the complete I-Evolve installation and configuration.
Execute steps sequentially. **Each step starts with a detection check — skip if already satisfied.**
Stop on failure or when user input is required.

## Step 0: Clone

**Check:** `ls packages/claude-plugin/skills/setup/SKILL.md` succeeds (already in repo).

If not in the I-Evolve repo:

```bash
git clone https://github.com/MoMeak9/I-Evolve.git
cd I-Evolve
```

## Step 1: Prerequisites

**Check all at once:**

```bash
command -v nvm 2>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ] && echo "nvm: installed"
command -v node && node --version
command -v pnpm && pnpm --version
```

### nvm — skip if already installed or Node >= 20 is available

If Node.js >= 20 is already available (regardless of how it was installed), skip nvm entirely.
Only install nvm if Node.js is missing or below v20:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
```

### Node.js — skip if `node --version` shows v20+

Already handled by nvm above, or user's system Node.

### pnpm — skip if `pnpm --version` succeeds

```bash
npm install -g pnpm@9
```

## Step 2: Install & Build

**Check:** `ls dist/` in any built package (e.g. `ls packages/shared/dist/`) to see if already built.

If `node_modules/` is missing:
```bash
pnpm install
```

If `dist/` directories are missing or stale:
```bash
pnpm build
```

If build fails, run `pnpm typecheck` to surface errors and stop.

## Step 3: Register Plugin

**Check:** `ls ~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` — skip if exists.

```bash
pnpm tsx apps/cli/src/index.ts setup all --project-root .
```

This registers:
- Claude Code plugin (skills + hooks) → `~/.claude/plugins/i-evolve/`
- MCP server config (Codex)

## Step 4: Configure Sync Settings

**Check:** `cat ~/.i-evolve/shared/memory/memory-pack.yaml` — if file exists and has `push_repos`, show current config and ask if user wants to modify. Skip write if unchanged.

The config file lives at `~/.i-evolve/shared/memory/memory-pack.yaml`.

If file is missing or needs configuration, ask the user:

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

**Check:** `pnpm tsx apps/cli/src/index.ts model status` — if a model shows `installed: true`, skip.

If no model is installed, ask the user whether to download now.

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

**Check:** `ls ~/.i-evolve/index.db` — if exists, run doctor to verify integrity instead of full bootstrap.

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

**Check:** `pnpm tsx apps/cli/src/index.ts daemon status` — skip if already running.

```bash
pnpm tsx apps/cli/src/index.ts daemon start
```

If it fails, try:
```bash
pnpm tsx apps/cli/src/index.ts daemon stop
pnpm tsx apps/cli/src/index.ts daemon start
```

## Step 8: Bind Project Identity

**Check:** `pnpm tsx apps/cli/src/index.ts identity detect` — if project is already bound (identity file exists), show current binding and ask if user wants to re-bind. Skip if confirmed unchanged.

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
