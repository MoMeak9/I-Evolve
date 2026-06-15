import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  buildCodexMcpConfigBlock,
  buildClaudeMcpServers,
  installClaudeCodePlugin,
  setupClaudeSettings,
  setupCodexConfig,
} from '../apps/cli/src/commands/setup.js';

describe('setup command helpers', () => {
  it('builds a Codex MCP config block for this workspace', () => {
    const block = buildCodexMcpConfigBlock('/repo/I-Evolve');

    expect(block).toContain('[mcp_servers.i-evolve]');
    expect(block).toContain('command = "pnpm"');
    expect(block).toContain('"/repo/I-Evolve"');
    expect(block).toContain('"mcp"');
    expect(block).toContain('"--stdio"');
  });

  it('inserts or replaces the i-evolve Codex MCP server block', () => {
    const dir = tempDir('ie-setup-codex');
    const configPath = join(dir, 'config.toml');
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, [
      'model = "gpt-5.5"',
      '',
      '[mcp_servers.old]',
      'command = "old"',
      '',
      '[mcp_servers.i-evolve]',
      'command = "stale"',
      'args = ["old"]',
      '',
    ].join('\n'), 'utf-8');

    try {
      setupCodexConfig({ configPath, projectRoot: '/repo/I-Evolve' });
      const content = readFileSync(configPath, 'utf-8');
      expect(content).toContain('[mcp_servers.old]');
      expect(content).toContain('[mcp_servers.i-evolve]');
      expect(content).toContain('"/repo/I-Evolve"');
      expect(content).not.toContain('command = "stale"');
      expect(content.match(/\[mcp_servers\.i-evolve\]/g)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs Claude Code plugin files into a target directory', () => {
    const dir = tempDir('ie-setup-claude');
    try {
      installClaudeCodePlugin({
        sourceDir: join(process.cwd(), 'packages', 'claude-plugin'),
        targetDir: join(dir, 'i-evolve'),
      });

      expect(existsSync(join(dir, 'i-evolve', '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(existsSync(join(dir, 'i-evolve', 'hooks', 'hooks.json'))).toBe(true);
      expect(existsSync(join(dir, 'i-evolve', '.mcp.json'))).toBe(true);
      expect(existsSync(join(dir, 'i-evolve', 'skills', 'onboarding', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(dir, 'i-evolve', 'skills', 'remember', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a Claude Code MCP server entry pointing at the checkout', () => {
    const servers = buildClaudeMcpServers('/repo/I-Evolve') as Record<string, { command: string; args: string[] }>;
    expect(servers['i-evolve'].command).toBe('pnpm');
    expect(servers['i-evolve'].args).toContain('/repo/I-Evolve');
    expect(servers['i-evolve'].args).toContain('--stdio');
  });

  it('registers plugin in settings.json while preserving existing keys (incl. secrets)', () => {
    const dir = tempDir('ie-setup-settings');
    const settingsPath = join(dir, 'settings.json');
    mkdirSync(dir, { recursive: true });
    // Pre-existing settings with a secret and an unrelated plugin.
    writeFileSync(settingsPath, JSON.stringify({
      env: { SECRET_TOKEN: 'keep-me' },
      enabledPlugins: { 'other@market': true },
    }, null, 2), 'utf-8');

    try {
      setupClaudeSettings({ settingsPath, projectRoot: '/repo/I-Evolve' });
      const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      // Existing keys preserved.
      expect(s.env.SECRET_TOKEN).toBe('keep-me');
      expect(s.enabledPlugins['other@market']).toBe(true);
      // New registration applied.
      expect(s.env.IEVOLVE_HOME).toBe('/repo/I-Evolve');
      expect(s.enabledPlugins['i-evolve@i-evolve']).toBe(true);
      expect(s.extraKnownMarketplaces['i-evolve'].source.source).toBe('git');
      expect(s.mcpServers['i-evolve'].command).toBe('pnpm');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships user-facing install docs and executable install script', () => {
    expect(existsSync(join(process.cwd(), 'README.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'docs', 'install-codex-claude.md'))).toBe(true);
    const script = join(process.cwd(), 'scripts', 'install.sh');
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).toBeGreaterThan(0);
    const installDocs = readFileSync(join(process.cwd(), 'docs', 'install-codex-claude.md'), 'utf-8');
    expect(installDocs).toContain('setup codex');
    expect(installDocs).toContain('skills/onboarding/SKILL.md');
  });
});

function tempDir(prefix: string): string {
  return join('/tmp', `${prefix}-${randomBytes(4).toString('hex')}`);
}
