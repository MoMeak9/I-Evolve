#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"

cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is required. Install pnpm first: https://pnpm.io/installation" >&2
  exit 1
fi

pnpm install
pnpm build
pnpm tsx apps/cli/src/index.ts setup "$TARGET" --project-root "$ROOT_DIR"

cat <<EOF

I-Evolve setup complete.

Next:
  pnpm tsx apps/cli/src/index.ts daemon start
  pnpm tsx apps/cli/src/index.ts mcp status

Restart Codex or Claude Code after setup so new MCP/plugin config is loaded.
EOF
