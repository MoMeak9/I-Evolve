import { describe, expect, it } from 'vitest';
import { detectProjectIdentity, normalizeGitRemoteUrl } from './project-identity.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('repo identity', () => {
  it('detects git remote and package names', () => {
    const dir = mkdtempSync(join('/tmp', 'ie-ident-'));
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/editor.git'], { cwd: dir });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/editor' }));

    const identity = detectProjectIdentity({ cwd: dir });

    expect(identity.repoId).toBe('acme/editor');
    expect(identity.gitRemote).toBe('git@github.com:acme/editor.git');
    expect(identity.packageNames).toContain('@acme/editor');
    expect(identity.domain).toBe('acme');
    expect(identity.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
