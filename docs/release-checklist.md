# I-Evolve Release Checklist / I-Evolve 发布检查清单

## 中文

发布 CLI、daemon、MCP server、Claude plugin 或 memory schema 变更前，使用此清单确认安装、测试、MCP、Dashboard 和治理链路可用。

## English

Use this checklist before publishing CLI, daemon, MCP server, Claude plugin, or memory schema changes. It verifies installation, tests, MCP, Dashboard, and governance flows.

## 必跑命令 / Required Commands

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

## 发布门禁 / Gates

中文：

- Schema fixtures 通过。
- Integration tests 通过。
- Pollution tests 通过。
- Secret / PII 安全检查通过。
- Migration dry-run 不写入文件。
- MCP server smoke test 通过。
- Dashboard bridge smoke test 通过。
- Setup dry-run 会打印 Codex MCP 与 Claude Code plugin 安装目标。
- `scripts/install.sh` 可执行且已有文档说明。
- Claude plugin package 文件存在。
- Doctor 能报告 CLI、daemon、store、SQLite/FTS、plugin、MCP、remote memory 状态。

English:

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

## Memory 版本 / Memory Versioning

中文：

- Code package version 与 memory Git version 独立。
- `schema_version` 变更必须通过 migration。
- Memory Git tag 使用 `memory-YYYY.MM.DD` 格式。

English:

- Code package versions and memory Git versions are independent.
- `schema_version` changes must go through migration.
- Memory Git tags should use `memory-YYYY.MM.DD`.
