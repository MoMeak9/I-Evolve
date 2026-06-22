import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export type CodexSetupMode = 'dev' | 'bin';

export interface SetupCodexConfigOptions {
  configPath: string;
  projectRoot: string;
  mode?: CodexSetupMode;
}

export interface InstallClaudeCodePluginOptions {
  sourceDir: string;
  targetDir: string;
}

export interface SetupClaudeSettingsOptions {
  settingsPath: string;
  projectRoot: string;
  marketplaceUrl?: string;
}

const CLAUDE_MARKETPLACE = 'i-evolve';
const CLAUDE_PLUGIN_KEY = 'i-evolve@i-evolve';
const DEFAULT_MARKETPLACE_URL = 'https://github.com/MoMeak9/I-Evolve.git';

export async function handleSetupCommand(
  subcommand: string | undefined,
  flags: Record<string, unknown>,
): Promise<void> {
  const target = subcommand ?? 'all';
  const projectRoot = resolve((flags['project-root'] as string | undefined) ?? process.cwd());
  const dryRun = Boolean(flags['dry-run']);
  const codexMode = resolveCodexSetupMode(flags.mode);

  if (target === 'codex' || target === 'all') {
    const configPath = resolveHome((flags['codex-config'] as string | undefined) ?? '~/.codex/config.toml');
    if (dryRun) {
      console.log(`[dry-run] Would update Codex MCP config: ${configPath}`);
      console.log(`[dry-run] Codex MCP mode: ${codexMode}`);
      console.log(buildCodexMcpConfigBlock(projectRoot, codexMode));
    } else {
      setupCodexConfig({ configPath, projectRoot, mode: codexMode });
      console.log(`Codex MCP configured (${codexMode} mode): ${configPath}`);
    }
  }

  if (target === 'claude-code' || target === 'all') {
    const sourceDir = join(projectRoot, 'packages', 'claude-plugin');
    const targetDir = resolveHome((flags['claude-plugin-dir'] as string | undefined) ?? '~/.claude/plugins/i-evolve');
    const settingsPath = resolveHome((flags['claude-settings'] as string | undefined) ?? '~/.claude/settings.json');
    if (dryRun) {
      console.log(`[dry-run] Would install Claude Code plugin: ${sourceDir} -> ${targetDir}`);
      console.log(`[dry-run] Would register plugin + MCP server in: ${settingsPath}`);
      console.log(`[dry-run]   env.IEVOLVE_HOME=${projectRoot}, enabledPlugins["${CLAUDE_PLUGIN_KEY}"]=true`);
    } else {
      installClaudeCodePlugin({ sourceDir, targetDir });
      setupClaudeSettings({ settingsPath, projectRoot });
      console.log(`Claude Code plugin installed: ${targetDir}`);
      console.log(`Claude Code settings updated: ${settingsPath}`);
    }
  }

  if (target === 'all') {
    if (dryRun) {
      console.log('[dry-run] Would run pnpm install, pnpm build, memory init-local, and doctor --bootstrap.');
    } else {
      runPnpm(projectRoot, ['install']);
      runPnpm(projectRoot, ['build']);
      runPnpm(projectRoot, ['tsx', 'apps/cli/src/index.ts', 'memory', 'init-local']);
      runPnpm(projectRoot, ['tsx', 'apps/cli/src/index.ts', 'doctor', '--bootstrap']);
    }
  }

  if (!['codex', 'claude-code', 'all'].includes(target)) {
    console.error('Usage: i-evolve setup <all|codex|claude-code> [--dry-run] [--mode dev|bin|auto]');
    process.exit(1);
  }
}

export function buildCodexMcpConfigBlock(projectRoot: string, mode: CodexSetupMode = 'dev'): string {
  if (mode === 'bin') {
    return [
      '[mcp_servers.i-evolve]',
      'command = "i-evolve"',
      'args = ["mcp", "start", "--stdio"]',
      'startup_timeout_sec = 30',
      '',
    ].join('\n');
  }

  const escapedRoot = tomlString(projectRoot);
  return [
    '[mcp_servers.i-evolve]',
    'command = "pnpm"',
    'args = [',
    '  "-C",',
    `  ${escapedRoot},`,
    '  "exec",',
    '  "tsx",',
    '  "apps/cli/src/index.ts",',
    '  "mcp",',
    '  "start",',
    '  "--stdio"',
    ']',
    'startup_timeout_sec = 30',
    '',
  ].join('\n');
}

export function setupCodexConfig(options: SetupCodexConfigOptions): void {
  const block = buildCodexMcpConfigBlock(options.projectRoot, options.mode ?? 'dev');
  if (!existsSync(dirname(options.configPath))) mkdirSync(dirname(options.configPath), { recursive: true });
  const current = existsSync(options.configPath) ? readFileSync(options.configPath, 'utf-8') : '';
  const next = replaceTomlTable(current, 'mcp_servers.i-evolve', block);
  writeFileSync(options.configPath, next, 'utf-8');
}

export function installClaudeCodePlugin(options: InstallClaudeCodePluginOptions): void {
  if (!existsSync(options.sourceDir)) throw new Error(`Claude plugin source not found: ${options.sourceDir}`);
  if (!existsSync(dirname(options.targetDir))) mkdirSync(dirname(options.targetDir), { recursive: true });
  cpSync(options.sourceDir, options.targetDir, { recursive: true, force: true });
}

/** The MCP server entry the plugin exposes to Claude Code, keyed by server name. */
export function buildClaudeMcpServers(projectRoot: string): Record<string, unknown> {
  return {
    'i-evolve': {
      command: 'pnpm',
      args: ['-C', projectRoot, 'exec', 'tsx', 'apps/cli/src/index.ts', 'mcp', 'start', '--stdio'],
    },
  };
}

/**
 * Register I-Evolve with Claude Code by merging into ~/.claude/settings.json:
 *   - env.IEVOLVE_HOME so the plugin's ${IEVOLVE_HOME} resolves to the checkout
 *   - enabledPlugins["i-evolve@i-evolve"] = true
 *   - extraKnownMarketplaces["i-evolve"] pointing at the git source
 *   - mcpServers["i-evolve"] as a direct fallback so tools work even before
 *     the marketplace plugin is fetched
 * Existing keys (including secrets in env) are preserved by read-merge-write.
 */
export function setupClaudeSettings(options: SetupClaudeSettingsOptions): void {
  const { settingsPath, projectRoot } = options;
  const url = options.marketplaceUrl ?? DEFAULT_MARKETPLACE_URL;
  if (!existsSync(dirname(settingsPath))) mkdirSync(dirname(settingsPath), { recursive: true });

  const settings: Record<string, unknown> = existsSync(settingsPath)
    ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>)
    : {};

  const env = (settings.env as Record<string, unknown>) ?? {};
  env.IEVOLVE_HOME = projectRoot;
  settings.env = env;

  const enabled = (settings.enabledPlugins as Record<string, unknown>) ?? {};
  enabled[CLAUDE_PLUGIN_KEY] = true;
  settings.enabledPlugins = enabled;

  const markets = (settings.extraKnownMarketplaces as Record<string, unknown>) ?? {};
  markets[CLAUDE_MARKETPLACE] = { source: { source: 'git', url } };
  settings.extraKnownMarketplaces = markets;

  const mcp = (settings.mcpServers as Record<string, unknown>) ?? {};
  Object.assign(mcp, buildClaudeMcpServers(projectRoot));
  settings.mcpServers = mcp;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function resolveCodexSetupMode(value: unknown): CodexSetupMode {
  if (value === undefined || value === 'auto') return commandExists('i-evolve') ? 'bin' : 'dev';
  if (value === 'dev' || value === 'bin') return value;
  throw new Error(`Invalid setup mode: ${String(value)}. Expected dev, bin, or auto.`);
}

function commandExists(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-c', 'command -v "$1"', 'sh', command];
  try {
    execFileSync(lookup, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function replaceTomlTable(content: string, table: string, block: string): string {
  const lines = content.split('\n');
  const header = `[${table}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...block.trimEnd().split('\n'), ...lines.slice(end)].join('\n').trimEnd() + '\n';
}

function resolveHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}


function runPnpm(cwd: string, args: string[]): void {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit' });
}
