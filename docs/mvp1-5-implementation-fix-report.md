# MVP1-5 Implementation Fix Report

Date: 2026-06-13

## Summary

This pass reviewed the current implementation against `docs/i-evolve-mvp-specs/02` through `06`, then fixed the gaps that most directly affect correctness before MVP6:

- SQLite/FTS search now excludes expired active memories.
- Tombstoned memory IDs can no longer be recreated.
- Index rebuild now validates Markdown schema before indexing.
- Git sync can rebuild index and write audit actions inside the Git workspace lock.
- Git push now writes a sync audit action after successful validation/push.
- Remote validation now checks `schema_version`, real `content_hash`, active expiration, tombstone reuse, secrets, and PII.
- Migrations now run under the Git workspace lock when the repo is Git-backed, bump schema version, create a Git commit, and emit a migration audit action.
- Audit schema/types now include explicit system actions: `checkout`, `sync_pull`, `sync_push`, and `migrate`.

## Verification

Fresh verification commands:

```bash
pnpm test
pnpm typecheck
```

Results:

- `pnpm test`: 8 test files passed, 91 tests passed before sync-action enum refinement; targeted rerun after refinement passed 34 relevant tests.
- `pnpm typecheck`: all 9 workspace projects passed.

## MVP1 Review

Status: mostly implemented for MVP1 scope.

Implemented:

- Daemon lifecycle, process lock, ping/health IPC.
- Observation append through daemon IPC.
- Audit append through daemon IPC.
- Serial transaction manager skeleton.
- Malformed observation/audit rejection.

Remaining concern:

- Transaction logging is skeletal; transaction IDs are not yet propagated into audit records.
- Later write paths added by MVP2/MVP3 are not all daemon-mediated yet. This is the largest architectural debt before multi-client MCP.

## MVP2 Review

Status: functional with important fixes applied.

Fixed in this pass:

- `MarkdownMemoryRepository.search()` now filters expired active memories.
- `MarkdownMemoryRepository.create()` rejects IDs that already exist in `tombstones/`.
- `MarkdownMemoryRepository.rebuildIndex()` validates memory schema before inserting into SQLite/FTS and counts invalid Markdown as errors.

Still incomplete:

- Memory write operations in CLI still instantiate `MarkdownMemoryRepository` directly instead of routing through daemon IPC.
- Atomic write is implemented, but there is no injected fault test for fsync/rename failure.
- Memory create/update/status/forget do not yet append audit actions consistently.

## MVP3 Review

Status: core AI evolution flow exists and is tested.

Implemented:

- Session summarizer, memory extractor, policy judge, mock/openAI-compatible providers.
- High-confidence activation, low-confidence rejection, scope downgrade, secret/tombstone policy checks.
- Evolution pipeline appends audit for every non-dry-run decision.
- Dry-run avoids writes and audit.

Remaining concern:

- `session finalize --auto-evolve` writes Markdown memory directly from CLI, not via daemon transaction.
- Rejected memory is represented in audit, but there is not yet a durable rejected-memory/tombstone registry beyond existing tombstone files.

## MVP4 Review

Status: plugin files and injection path are present.

Implemented:

- Plugin manifest, hook config, and skill documents are present and covered by tests.
- `inject` retrieves active, in-scope, non-expired memories and formats Markdown context.
- `observe` is daemon-mediated and fail-soft when daemon is unavailable.

Remaining concern:

- Stop/finalize path can still write directly through CLI.
- Hook behavior is covered by structure tests, not end-to-end execution through an installed Claude Code plugin runtime.

## MVP5 Review

Status: significantly hardened in this pass.

Fixed in this pass:

- `pull`, `checkout`, and `rollback` can run index rebuild callbacks while the Git workspace lock is held.
- `pull`, `push`, `checkout`, `rollback`, and migration flows can emit structured audit actions.
- `push` still validates before pushing and now audits successful pushes.
- `validateMemoryRepo()` now enforces the important validation checklist items that were previously missing.
- `runMigrations()` now locks, applies steps, bumps `schema_version`, commits with `memory(system): migrate schema to <version>`, and emits audit when the repo is Git-backed.
- Migration dry-run remains non-mutating.

Remaining concern:

- Pull conflict reporting is still a message string, not a structured conflict report artifact.
- CLI `migrate` currently has an empty migration registry by design, so the mechanism is ready but no real schema steps are registered.
- Git sync audit uses callback injection; daemon-owned sync orchestration should provide the production callback implementation in a later hardening pass.

## Files Changed

- `packages/storage/src/memory-repository.ts`
- `packages/storage/src/storage.test.ts`
- `packages/git-sync/src/git-memory-sync.ts`
- `packages/git-sync/src/validate.ts`
- `packages/git-sync/src/migration.ts`
- `packages/git-sync/src/git-sync.test.ts`
- `packages/shared/src/types.ts`
- `packages/schema/schemas/audit-action.schema.json`
- `apps/cli/src/commands/remote.ts`
- `apps/cli/src/commands/migrate.ts`

## Recommended Next Step Before MVP6

Before implementing cross-repo retrieval and conflict Top-K, close the daemon-write gap:

1. Add daemon IPC requests for memory create/update/status/forget/index rebuild/sync operations.
2. Move repository construction and audit append into daemon-owned services.
3. Make CLI a thin client for all writes.
4. Add integration tests proving CLI writes fail when daemon is unavailable and succeed through daemon IPC.

This keeps MVP6 from building cross-repo retrieval on top of write paths that can bypass locking, audit, and transaction boundaries.
