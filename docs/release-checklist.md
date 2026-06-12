# I-Evolve Release Checklist

Use this checklist before publishing CLI, daemon, MCP server, Claude plugin, or memory schema changes.

## Required Commands

```bash
pnpm build
pnpm test
pnpm typecheck
i-evolve repair verify-hashes
i-evolve migrate run --dry-run
i-evolve mcp status
```

## Gates

- Schema fixtures pass.
- Integration tests pass.
- Pollution tests pass.
- Security checks pass for secret and PII validation.
- Migration dry-run does not write files.
- MCP server smoke test passes.
- Claude plugin package files are present.

## Memory Versioning

- Code package versions and memory Git versions are independent.
- `schema_version` changes must go through migration.
- Memory Git tags should use `memory-YYYY.MM.DD`.
