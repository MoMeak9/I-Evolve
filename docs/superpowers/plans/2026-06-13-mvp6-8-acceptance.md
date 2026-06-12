# MVP6-8 Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MVP6-8 so the documented acceptance items are executable and verifiable, not only prototype-shaped.

**Architecture:** Keep daemon as the only write coordinator. MCP and Dashboard call daemon IPC/bridge APIs; retrieval uses storage repositories and FTS-derived scores with project identity metadata. Dashboard remains dependency-light but must expose real pages and actions against a local daemon bridge.

**Tech Stack:** TypeScript, Node IPC over Unix socket, static dashboard TypeScript, vitest, tsup, better-sqlite3 FTS.

---

### Task 1: Daemon Memory API

**Files:**
- Modify: `packages/daemon/src/ipc-types.ts`
- Modify: `packages/daemon/src/daemon.ts`
- Modify: `packages/daemon/package.json`
- Test: `packages/daemon/src/daemon.test.ts`

- [ ] Add failing daemon tests for `memory.recall`, `memory.search`, `memory.remember`, `memory.forget`, `memory.audit`, `memory.explain`, `memory.sync`, `dashboard.summary`, and `index.rebuild`.
- [ ] Extend `DaemonRequest` with typed memory/dashboard/git/index requests.
- [ ] Implement daemon handlers using `MarkdownMemoryRepository`, `retrieveContextDebug`, `GitMemorySync`, and audit writer under `SerialTransactionManager` for writes.
- [ ] Verify targeted daemon tests pass.

### Task 2: Real MCP stdio Server

**Files:**
- Modify: `apps/mcp-server/src/server.ts`
- Modify: `apps/mcp-server/src/daemon-client.ts`
- Modify: `apps/cli/src/commands/mcp.ts`
- Test: `tests/mcp-server.test.ts`

- [ ] Add failing smoke test that starts the MCP stdio command and performs `initialize`, `tools/list`, and `tools/call`.
- [ ] Implement concrete daemon client over `sendRequest`.
- [ ] Implement minimal MCP JSON-RPC stdio transport with documented tools and readable errors.
- [ ] Make `i-evolve mcp start --stdio` run the server process instead of printing readiness.

### Task 3: Dashboard Bridge And Pages

**Files:**
- Modify: `packages/daemon/src/ipc-types.ts`
- Modify: `packages/daemon/src/daemon.ts`
- Create: `apps/dashboard/src/bridge.ts`
- Modify: `apps/dashboard/src/api/daemonClient.ts`
- Modify: `apps/dashboard/src/main.ts`
- Modify: `apps/dashboard/src/styles.css`
- Test: `tests/dashboard.test.ts`

- [ ] Add failing tests for dashboard rendering real Memories/Audit/Conflicts/Daemon/Git/Settings panels and invoking forget/deprecate/rollback through the client.
- [ ] Add a local HTTP bridge that maps documented Dashboard endpoints to daemon IPC.
- [ ] Replace static shell with functional panels and action buttons.
- [ ] Verify dashboard tests pass.

### Task 4: MVP6 Retrieval Hardening

**Files:**
- Modify: `packages/storage/src/context-retrieval.ts`
- Modify: `packages/storage/src/project-identity.ts`
- Modify: `apps/cli/src/commands/identity.ts`
- Test: `packages/storage/src/context-retrieval.test.ts`
- Test: `packages/storage/src/project-identity.test.ts`
- Test: `tests/pollution.test.ts`

- [ ] Add failing tests for FTS score ordering, recent session summary Top 2, stable `**` glob matching, safer conflict grouping, go.mod/workspace/manual identity detection, and persistent `identity bind`.
- [ ] Thread query/FTS ranks into retrieval scoring while preserving scope filters.
- [ ] Add session summary bucket and Markdown formatting.
- [ ] Persist identity bindings as project profiles.
- [ ] Expand pollution tests for deprecated/rejected, task-to-global, secret/PII, rollback index rebuild, daemon write failure, and revision conflicts.

### Task 5: MVP8 Doctor/Repair/Release Gates

**Files:**
- Modify: `apps/cli/src/index.ts`
- Test: CLI/integration tests as appropriate
- Modify: `docs/mvp6-8-implementation-report.md`
- Modify: `docs/release-checklist.md`

- [ ] Add/adjust tests for doctor output covering CLI, daemon, dirs, repo, git, schema, sqlite, FTS, audit, plugin, MCP, remote.
- [ ] Add `repair audit-log`, `repair git-cleanup`, dry-run behavior, and system audit writes.
- [ ] Update implementation report from prototype to acceptance evidence.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and MCP/dashboard smoke checks.
