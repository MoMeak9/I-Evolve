import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export interface SetupCodexConfigOptions {
  configPath: string;
  projectRoot: string;
}

export interface InstallClaudeCodePluginOptions {
  sourceDir: string;
  targetDir: string;
}

export async function handleSetupCommand(
  subcommand: string | undefined,
  flags: Record<string, unknown>,
): Promise<void> {
  const target = subcommand ?? 'all';
  const projectRoot = resolve((flags['project-root'] as string | undefined) ?? process.cwd());
  const dryRun = Boolean(flags['dry-run']);

  if (target === 'codex' || target === 'all') {
    const configPath = resolveHome((flags['codex-config'] as string | undefined) ?? '~/.codex/config.toml');
    if (dryRun) {
      console.log(`[dry-run] Would update Codex MCP config: ${configPath}`);
      console.log(buildCodexMcpConfigBlock(projectRoot));
    } else {
      setupCodexConfig({ configPath, projectRoot });
      console.log(`Codex MCP configured: ${configPath}`);
    }
  }

  if (target === 'claude-code' || target === 'all') {
    const sourceDir = join(projectRoot, 'packages', 'claude-plugin');
    const targetDir = resolveHome((flags['claude-plugin-dir'] as string | undefined) ?? '~/.claude/plugins/i-evolve');
    if (dryRun) {
      console.log(`[dry-run] Would install Claude Code plugin: ${sourceDir} -> ${targetDir}`);
    } else {
      installClaudeCodePlugin({ sourceDir, targetDir });
      console.log(`Claude Code plugin installed: ${targetDir}`);
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
    console.error('Usage: i-evolve setup <all|codex|claude-code> [--dry-run]');
    process.exit(1);
  }
}

export function buildCodexMcpConfigBlock(projectRoot: string): string {
  const escapedRoot = tomlString(projectRoot);
  return [
    '[mcp_servers.i-evolve]',
    'command = "pnpm"',
    'args = [',
    '  "--dir",',
    `  ${escapedRoot},`,
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
  const block = buildCodexMcpConfigBlock(options.projectRoot);
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
