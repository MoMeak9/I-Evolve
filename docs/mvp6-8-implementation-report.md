# MVP6-8 Acceptance Implementation Report

Date: 2026-06-13

## 中文摘要

本报告记录 MVP6-8 从 prototype 推进到可验收状态的实现结果。当前实现已经覆盖跨仓召回、MCP 多客户端共享、Dashboard/doctor/repair/release hardening，以及 Codex / Claude Code 的零门槛 setup 入口。

## English Summary

This report records the work that upgraded MVP6-8 from a prototype to an acceptance-ready implementation. The current implementation covers cross-repo retrieval, MCP multi-client sharing, Dashboard/doctor/repair/release hardening, and zero-entry setup for Codex / Claude Code.

## Summary

This pass upgrades the previous MVP6-8 foundation into executable acceptance coverage for `docs/i-evolve-mvp-specs/07` through `09`.

## MVP6: Cross-Repo Retrieval

Implemented:

- Project identity detection from Git remote, `package.json`, `go.mod`, `pnpm-workspace.yaml`, and project profiles.
- Persistent `i-evolve identity bind --project <id>` via `project-profile.md`.
- `applies_to` matching for repo, package, and path globs, including `**`.
- FTS query score contribution for Top-K ordering.
- Scope filtering, expired/deprecated/rejected exclusion, same-topic conflict suppression, and safer generic-tag handling.
- `recent session summary Top 2` bucket using session-summary refs/tags.
- `i-evolve inject --debug` stats including FTS match counts and conflict suppression.

Evidence:

- `packages/storage/src/context-retrieval.test.ts`
- `packages/storage/src/project-identity.test.ts`
- `tests/pollution.test.ts`

## MVP7: MCP Server

Implemented:

- `apps/mcp-server` package with a concrete daemon-backed IPC client.
- Minimal MCP-compatible JSON-RPC stdio transport for `initialize`, `tools/list`, and `tools/call`.
- Tools: `recall`, `remember`, `forget`, `search_memory`, `audit_memory`, `explain_memory`, and `sync_memory`.
- `i-evolve mcp start --stdio` now runs the stdio transport instead of printing a readiness stub.
- Daemon startup health gate and readable JSON-RPC errors.
- Daemon IPC endpoints for memory recall/search/remember/forget/audit/explain/sync.

Evidence:

- `tests/mcp-server.test.ts` starts a real daemon and MCP stdio process, then calls `recall`.
- `packages/daemon/src/daemon.test.ts` verifies daemon memory IPC endpoints.

## MVP8: Dashboard, Doctor, Repair, Release

Implemented:

- Zero-entry setup commands for Codex MCP and Claude Code plugin installation.
- `scripts/install.sh` for dependency install, build, setup, memory init, and doctor.
- User-facing install docs in `README.md` and `docs/install-codex-claude.md`.
- Functional static dashboard panels for Memories, Audit, Conflicts, Daemon Status, Git Status, and Settings.
- Dashboard actions for forget, deprecate, and rollback routed through the daemon client.
- Local dashboard HTTP bridge for documented endpoints including `/health`, `/memories`, `/audit`, `/conflicts`, `/git/status`, `/index/rebuild`, and memory actions.
- `i-evolve dashboard bridge [--port]` CLI entry point.
- Expanded `i-evolve doctor` status signals for CLI version, SQLite/FTS, Claude plugin, MCP, Git/remote memory.
- `repair audit-log`, `repair git-cleanup`, dry-run behavior, and system audit writes.
- Expanded pollution tests for deprecated/rejected injection, scope leakage, sensitive memory blocking, daemon write failure, and revision conflicts.

Evidence:

- `tests/setup.test.ts`
- `tests/dashboard.test.ts`
- `tests/pollution.test.ts`
- `packages/daemon/src/daemon.test.ts`

## Verification

中文：本轮验收执行了以下命令，结果全部通过。

English: The following verification commands were run for this acceptance pass, and all passed.

Run for this acceptance pass:

```bash
pnpm test
pnpm typecheck
pnpm build
node --import tsx <dashboard bridge smoke>
pnpm tsx apps/cli/src/index.ts setup all --dry-run --project-root /tmp/i-evolve-demo --codex-config /tmp/codex/config.toml --claude-plugin-dir /tmp/claude/plugins/i-evolve
```

Observed:

- `pnpm test`: 13 test files, 126 tests passed.
- `pnpm typecheck`: all workspace typecheck scripts passed.
- `pnpm build`: all workspace build scripts passed.
- Dashboard bridge smoke: `GET /health` returned HTTP 200 with daemon status `running`.
- Setup dry-run smoke: printed Codex MCP config and Claude Code plugin targets without writing real user config.

## Remaining Non-Blocking Hardening

- Replace the minimal JSON-RPC MCP transport with an official MCP SDK transport when the dependency is adopted.
- Replace the dependency-light static dashboard with a richer frontend framework if product scope grows.
- Add browser-level visual regression tests for the dashboard.
- Replace placeholder doctor values such as last pull time and unpushed commit count with exact Git remote calculations.
