import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  buildCodexMcpConfigBlock,
  installClaudeCodePlugin,
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
      expect(existsSync(join(dir, 'i-evolve', 'skills', 'remember', 'SKILL.md'))).toBe(true);
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
    expect(readFileSync(join(process.cwd(), 'docs', 'install-codex-claude.md'), 'utf-8')).toContain('setup codex');
  });
});

function tempDir(prefix: string): string {
  return join('/tmp', `${prefix}-${randomBytes(4).toString('hex')}`);
}
