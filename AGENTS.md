# Codex Guidance For I-Evolve MCP

For non-trivial repository work in Codex, use the I-Evolve MCP tools as a short memory loop:

- Before planning or implementing, call `recall` with the repository, feature, or bug topic to load relevant project memory.
- After implementation, call `remember` only for durable decisions, conventions, architecture notes, or surprising debugging outcomes that future agents should reuse.
- When memory behavior is confusing, use `audit_memory` to review governance/history and `explain_memory` to inspect why a memory was selected or how it was derived.
- Use the rest of the available MCP tool surface as needed: `forget`, `search_memory`, and `sync_memory`. The canonical Codex/Claude install guide documents the full available tool list in `docs/install-codex-claude.md`.

Keep injected memory concise, never store secrets or credentials, and prefer project-level conventions over transient task details.
