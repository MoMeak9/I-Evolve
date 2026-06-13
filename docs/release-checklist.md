# I-Evolve Release Checklist

Use this checklist before publishing CLI, daemon, MCP server, Claude plugin, or memory schema changes.

## Required Commands

```bash
pnpm build
pnpm test
pnpm typecheck
./scripts/install.sh all
pnpm tsx apps/cli/src/index.ts setup all --dry-run
i-evolve repair verify-hashes
i-evolve repair audit-log --dry-run
i-evolve repair git-cleanup --dry-run
i-evolve migrate run --dry-run
i-evolve mcp status
i-evolve dashboard bridge --port 17361
```

## Gates

- Schema fixtures pass.
- Integration tests pass.
- Pollution tests pass.
- Security checks pass for secret and PII validation.
- Migration dry-run does not write files.
- MCP server smoke test passes.
- Dashboard bridge smoke test passes.
- Setup dry-run prints Codex MCP and Claude Code plugin install targets.
- `scripts/install.sh` is executable and documented.
- Claude plugin package files are present.
- Doctor reports CLI, daemon, store, SQLite/FTS, plugin, MCP, and remote memory status.

## Memory Versioning

- Code package versions and memory Git versions are independent.
- `schema_version` changes must go through migration.
- Memory Git tags should use `memory-YYYY.MM.DD`.
