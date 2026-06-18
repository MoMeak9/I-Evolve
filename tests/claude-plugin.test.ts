import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const pluginDir = join(root, 'packages', 'claude-plugin');

function hookCommandText(hook: { command: string; args?: string[] }): string {
  return [hook.command, ...(hook.args ?? [])].join(' ');
}

describe('Claude plugin structure', () => {
  it('has a valid plugin.json', () => {
    const p = join(pluginDir, '.claude-plugin', 'plugin.json');
    expect(existsSync(p)).toBe(true);
    const json = JSON.parse(readFileSync(p, 'utf-8'));
    expect(json.name).toBe('i-evolve');
    expect(json.version).toBeDefined();
  });

  it('has hooks.json with SessionStart, PostToolUse, Stop', () => {
    const p = join(pluginDir, 'hooks', 'hooks.json');
    expect(existsSync(p)).toBe(true);
    const json = JSON.parse(readFileSync(p, 'utf-8'));
    expect(json.hooks.SessionStart).toBeDefined();
    expect(json.hooks.PostToolUse).toBeDefined();
    expect(json.hooks.Stop).toBeDefined();
  });

  it('SessionStart hook calls i-evolve inject', () => {
    const json = JSON.parse(readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8'));
    const hook = json.hooks.SessionStart[0].hooks[0];
    expect(hook.type).toBe('command');
    expect(hookCommandText(hook)).toBe('i-evolve inject --format markdown');
  });

  it('PostToolUse hook calls i-evolve observe', () => {
    const json = JSON.parse(readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8'));
    const hook = json.hooks.PostToolUse[0].hooks[0];
    expect(hook.type).toBe('command');
    expect(hookCommandText(hook)).toBe('i-evolve observe --phase post_tool_use --source claude-code');
  });

  it('Stop hook calls i-evolve session finalize', () => {
    const json = JSON.parse(readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8'));
    const hook = json.hooks.Stop[0].hooks[0];
    expect(hook.type).toBe('command');
    expect(hookCommandText(hook)).toBe('i-evolve session finalize --auto-evolve');
  });

  it('has all five skills', () => {
    for (const skill of ['init', 'remember', 'audit', 'forget', 'explain-memory']) {
      expect(existsSync(join(pluginDir, 'skills', skill, 'SKILL.md'))).toBe(true);
    }
  });
});
