---
name: onboarding
description: Use when setting up I-Evolve for an agent, checking MCP or Claude Code plugin installation, validating daemon health, or guiding daily memory use.
---

# I-Evolve: Onboarding And Daily Use

Guide a user from first install through normal memory workflows. Do not edit the memory store directly; use the CLI, hooks, or MCP tools.

## 1. Detect The Situation

Ask which client they want if it is unclear: Codex, Claude Code, or both. Default to both for a first-time setup.

Use `i-evolve` commands when the binary is on `PATH`. In a source checkout, use:

```bash
pnpm tsx apps/cli/src/index.ts <command>
```

## 2. Install Or Configure

For a first-time install from the I-Evolve repository:

```bash
./scripts/install.sh all
```

For targeted setup:

```bash
i-evolve setup codex
i-evolve setup claude-code
i-evolve setup all --dry-run
```

After setup, tell the user to restart Codex or Claude Code so MCP tools, hooks, and skills are reloaded.

## 3. Start And Verify

```bash
i-evolve daemon start
i-evolve doctor --bootstrap
i-evolve mcp status
```

Healthy output should show the daemon running, local memory initialized, SQLite/FTS available, and MCP ready.

## 4. Bind Project Identity And Shared Memory

For a first-time repository, run the guided wizard. It starts the daemon, binds
identity after confirmation, and asks which remote git repo to use as shared
memory:

```bash
i-evolve init
```

Without an interactive terminal, detect first, ask the user for the project id /
domain and which git remote to use as memory, then apply non-interactively:

```bash
i-evolve identity detect
i-evolve init --yes --project <project-id> --domain <domain> --remote <git-url>
# or --skip-remote for local-only memory
```

Use short, durable identifiers such as `billing-api`, `web-editor`, or `mobile-app`.
The `init` and `inject`/`observe` hooks auto-start the daemon, so it does not need
to be started by hand.

## 5. Daily Use

Use the most direct surface available:

- Context recall: MCP `recall`, or CLI `i-evolve inject --query "<topic>"`.
- Save durable knowledge: MCP `remember`, or the `remember` skill.
- Find existing memories: MCP `search_memory`, or CLI `i-evolve memory search "<query>"`.
- Explain provenance: MCP `explain_memory`, or the `explain-memory` skill.
- Review governance decisions: MCP `audit_memory`, or the `audit` skill.
- Remove stale memory: MCP `forget`, or the `forget` skill. Confirm before tombstoning.
- Sync shared memory: MCP `sync_memory` with `status`, `pull`, or `push`.

Never store secrets, credentials, tokens, or private personal data.

## 6. Troubleshooting

If MCP tools are missing in Codex:

1. Confirm `~/.codex/config.toml` contains `[mcp_servers.i-evolve]`.
2. Restart Codex.
3. Run `i-evolve daemon start`.
4. Run `i-evolve mcp status`.

If Claude Code skills or hooks are missing:

1. Confirm `~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` exists.
2. Restart Claude Code.
3. Run `i-evolve doctor --bootstrap`.

If the daemon is blocked or stale, run:

```bash
i-evolve daemon status
i-evolve daemon stop
i-evolve daemon start
```
