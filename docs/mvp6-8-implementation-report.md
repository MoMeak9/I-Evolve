# MVP6-8 Implementation Report

Date: 2026-06-13

## Summary

This pass implemented the remaining MVP6-8 foundations from `docs/i-evolve-mvp-specs/07` through `09`.

## MVP6: Cross-Repo Retrieval

Implemented:

- Project identity detection from Git remote and package metadata.
- Git remote URL normalization for SSH and HTTPS remotes.
- Project profile parsing from Markdown frontmatter.
- `applies_to` matching for repo glob patterns, package names, and path patterns.
- Scope priority scoring: task, repo, project, domain, user, global.
- Same-topic conflict suppression with `ConflictReport`.
- Debug retrieval stats for candidates, expired/deprecated/scope-mismatch filters, injected count, and suppressed conflicts.
- `i-evolve identity detect`.
- `i-evolve inject --debug`.
- `i-evolve retrieval explain --memory <id>` minimal explanation.

Tests added:

- Repo ID detection from Git remote.
- Project profile matching.
- Cross-repo `applies_to` behavior.
- Repo memory priority over project memory.
- Debug counters.
- Pollution tests for repo A not leaking into repo B and domain memory crossing related repos.

## MVP7: MCP Server

Implemented:

- `apps/mcp-server` workspace package.
- MCP handler boundary with `recall`, `remember`, `forget`, `search_memory`, `audit_memory`, `explain_memory`, and `sync_memory`.
- Daemon health gate for startup.
- `i-evolve mcp start --stdio` and `i-evolve mcp status` CLI entry points.

Notes:

- The current MCP server is a testable handler and stdio-ready package boundary, not yet a full SDK-backed MCP transport implementation.
- The handler API is intentionally daemon-client based so future transport wiring does not bypass daemon writes.

## MVP8: Dashboard, Doctor, Repair, Release

Implemented:

- `apps/dashboard` workspace package.
- Static Dashboard MVP shell with pages/navigation for Memories, Memory Detail, Audit, Conflicts, Daemon Status, Git Status, and Settings.
- Dashboard daemon API client boundary for local-only daemon bridge calls.
- Enhanced `i-evolve doctor` with memory repo, schema version, SQLite, audit, Git, remote memory, and MCP status signals.
- `i-evolve repair rebuild-index`.
- `i-evolve repair verify-hashes`.
- Release checklist at `docs/release-checklist.md`.
- Pollution tests covering core cross-repo contamination risks.

Notes:

- The Dashboard is a static, dependency-light MVP shell. A full interactive React/Vite dashboard can be layered on later if/when frontend dependencies are adopted.
- Dashboard actions are intentionally routed through a daemon bridge client boundary and do not read/write Markdown directly.

## Verification

Fresh verification commands used during this pass:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Observed results:

- `pnpm test`: 11 test files, 104 tests passed.
- `pnpm typecheck`: all workspace projects passed.
- `pnpm build`: all workspace build scripts completed successfully.

## Remaining Hardening

- Replace the MCP handler shim with a concrete MCP SDK transport while preserving daemon-only writes.
- Add daemon IPC endpoints for memory create/update/forget/index/sync so CLI, MCP, and Dashboard all share one write coordinator.
- Add a local Dashboard daemon bridge implementation for the documented HTTP-like endpoints.
- Add e2e tests for installed Claude plugin, MCP stdio transport, and Dashboard bridge actions.
