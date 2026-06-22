# Install I-Evolve For Codex And Claude Code / 为 Codex 和 Claude Code 安装 I-Evolve

## 中文

这份文档说明如何安装 I-Evolve，让 Codex 和 Claude Code 共用同一个本地 daemon-backed memory。

## English

This guide installs I-Evolve so Codex and Claude Code can use the same local daemon-backed memory.

## 环境要求 / Requirements

中文：

- Node.js 20+
- pnpm 9+
- Git

English:

- Node.js 20+
- pnpm 9+
- Git

## 一条命令安装 / One-Command Setup

```bash
cd /path/to/I-Evolve
./scripts/install.sh all
```

中文：脚本会执行：

English: The script runs:

```bash
pnpm install
pnpm build
pnpm tsx apps/cli/src/index.ts setup all --project-root /path/to/I-Evolve
```

## Codex

中文：首次安装时，推荐运行 `setup all` 一次，以安装依赖、构建项目、初始化本地 memory，并配置 Codex/Claude Code。只需要 Codex 时，也可以运行 `setup codex --bootstrap`，它会在配置 Codex 后执行同样的运行时前置步骤（`pnpm install`、`pnpm build`、`memory init-local`、`doctor --bootstrap`）。

English: For first-time installs, run `setup all` once to install dependencies, build the project, initialize local memory, and configure Codex/Claude Code. If you only need Codex, you can run `setup codex --bootstrap`; it configures Codex and then performs the same runtime prerequisite steps (`pnpm install`, `pnpm build`, `memory init-local`, and `doctor --bootstrap`).

```bash
pnpm tsx apps/cli/src/index.ts setup all
# or, for Codex only:
pnpm tsx apps/cli/src/index.ts setup codex --bootstrap
```

中文：已有安装只想快速刷新 Codex 配置时，运行不带 `--bootstrap` 的配置模式：

English: For existing installations, keep the fast config-only mode by omitting `--bootstrap`:

```bash
pnpm tsx apps/cli/src/index.ts setup codex
```

中文：该命令会更新 `~/.codex/config.toml`，加入：

English: This updates `~/.codex/config.toml` with:

```toml
[mcp_servers.i-evolve]
command = "pnpm"
args = [
  "-C",
  "/path/to/I-Evolve",
  "exec",
  "tsx",
  "apps/cli/src/index.ts",
  "mcp",
  "start",
  "--stdio"
]
startup_timeout_sec = 30
```

中文：配置完成后重启 Codex。如果没有使用 `setup all` 或 `setup codex --bootstrap`，使用 MCP tools 前请先完成前置步骤并启动 daemon：

English: Restart Codex after setup. If you did not use `setup all` or `setup codex --bootstrap`, complete the prerequisites and start the daemon before using MCP tools:

```bash
pnpm tsx apps/cli/src/index.ts daemon start
pnpm tsx apps/cli/src/index.ts mcp status
```

中文：可用 MCP tools：

English: Available MCP tools:

- `recall`
- `remember`
- `forget`
- `search_memory`
- `audit_memory`
- `explain_memory`
- `sync_memory`

### Codex MCP Usage Guidance

English: Keep this workflow short enough to paste into Codex agent context:

- Before planning non-trivial repository work, call `recall` with the repository, feature, or bug topic.
- After implementation, call `remember` only for durable decisions, project conventions, architecture notes, or surprising debugging outcomes; skip transient task details and never store secrets.
- When memory behavior is confusing, use `audit_memory` for governance/history and `explain_memory` for why a memory was selected or how it was derived.
- Use the other tools listed above (`forget`, `search_memory`, and `sync_memory`) to remove stale memory, find existing notes, or sync shared memory.

中文：这段工作流应保持足够短，方便粘贴到 Codex agent context：

- 在规划非平凡仓库工作前，使用仓库、功能或 bug 主题调用 `recall`。
- 实现后，只用 `remember` 记录持久决策、项目约定、架构说明或重要调试结论；跳过临时任务细节，且绝不存储密钥。
- memory 行为令人困惑时，用 `audit_memory` 查看治理/历史，用 `explain_memory` 查看记忆为何被选中或如何产生。
- 需要删除过期记忆、查找现有记录或同步共享记忆时，使用上方其他工具（`forget`、`search_memory`、`sync_memory`）。

## Claude Code

中文：安装 Claude Code plugin：

English: Install the Claude Code plugin:

```bash
pnpm tsx apps/cli/src/index.ts setup claude-code
```

中文：该命令会：1) 把 plugin bundle 复制到 `~/.claude/plugins/i-evolve`；2) 在 `~/.claude/settings.json` 中注册 MCP server、启用 plugin、并写入 `IEVOLVE_HOME`（读-合并-写，保留已有配置与密钥）。

English: This command 1) copies the plugin bundle to `~/.claude/plugins/i-evolve`, and 2) registers the MCP server, enables the plugin, and writes `IEVOLVE_HOME` in `~/.claude/settings.json` (read-merge-write; existing keys and secrets are preserved).

```text
~/.claude/plugins/i-evolve
```

中文：写入 `~/.claude/settings.json` 的内容：

English: Written into `~/.claude/settings.json`:

- `env.IEVOLVE_HOME = <项目根 / project root>`（供 plugin 的 `${IEVOLVE_HOME}` 解析 / resolves the plugin's `${IEVOLVE_HOME}`）
- `enabledPlugins["i-evolve@i-evolve"] = true`
- `extraKnownMarketplaces["i-evolve"]`（指向 GitHub 源 / points at the GitHub source）
- `mcpServers["i-evolve"]`（直接可用的 MCP server 兜底 / direct MCP server fallback）

中文：安装内容：

English: Installed plugin contents:

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `hooks/hooks.json`
- `skills/onboarding/SKILL.md`
- `skills/init/SKILL.md`
- `skills/remember/SKILL.md`
- `skills/forget/SKILL.md`
- `skills/audit/SKILL.md`
- `skills/explain-memory/SKILL.md`

中文：安装后重启 Claude Code，使 MCP tools、hooks 和 skills 生效。

English: Restart Claude Code after setup so MCP tools, hooks, and skills are loaded.

中文：作为 marketplace 安装（可选）：

English: Install as a marketplace (optional):

```bash
claude plugin marketplace add https://github.com/MoMeak9/I-Evolve.git
claude plugin install i-evolve@i-evolve
```

## 项目身份 / Project Identity

中文：为当前仓库绑定稳定项目身份：

English: Bind a repository to a stable project identity:

```bash
pnpm tsx apps/cli/src/index.ts identity bind --project my-project --domain my-domain
```

中文：该命令会在 memory store 中写入 `project-profile.md`。

English: This writes a `project-profile.md` file in the memory store.

## 健康检查 / Health Check

```bash
pnpm tsx apps/cli/src/index.ts doctor --bootstrap
pnpm tsx apps/cli/src/index.ts mcp status
```

中文：期望看到：

English: Expected:

- daemon running / daemon 正在运行
- memory repo exists / memory repo 存在
- SQLite/FTS available / SQLite/FTS 可用
- MCP server ready / MCP server 就绪
- Claude plugin present in the source tree / 源码中存在 Claude plugin

## Dry Run / 仅预览不写入

中文：预览所有文件写入：

English: Preview all file writes:

```bash
pnpm tsx apps/cli/src/index.ts setup all --dry-run
```

中文：测试或受管环境中可以指定自定义路径：

English: Use custom paths in tests or managed environments:

```bash
pnpm tsx apps/cli/src/index.ts setup codex \
  --codex-config /tmp/codex/config.toml \
  --project-root /path/to/I-Evolve

pnpm tsx apps/cli/src/index.ts setup claude-code \
  --claude-plugin-dir /tmp/claude/plugins/i-evolve \
  --project-root /path/to/I-Evolve
```

## 排障 / Troubleshooting

中文：如果 Codex 中看不到 I-Evolve tools：

English: If Codex does not show I-Evolve tools:

1. 确认 `~/.codex/config.toml` 包含 `[mcp_servers.i-evolve]`。  
   Confirm `~/.codex/config.toml` contains `[mcp_servers.i-evolve]`.
2. 重启 Codex。  
   Restart Codex.
3. 启动 daemon：`pnpm tsx apps/cli/src/index.ts daemon start`。  
   Start the daemon: `pnpm tsx apps/cli/src/index.ts daemon start`.
4. 检查 MCP 状态：`pnpm tsx apps/cli/src/index.ts mcp status`。  
   Check MCP status: `pnpm tsx apps/cli/src/index.ts mcp status`.

中文：如果 Claude Code skills 没有出现：

English: If Claude Code skills do not appear:

1. 确认 `~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` 存在。  
   Confirm `~/.claude/plugins/i-evolve/.claude-plugin/plugin.json` exists.
2. 重启 Claude Code。  
   Restart Claude Code.
3. 运行 `init` skill，或手动执行 `i-evolve doctor --bootstrap`。  
   Run the `init` skill or manually run `i-evolve doctor --bootstrap`.
