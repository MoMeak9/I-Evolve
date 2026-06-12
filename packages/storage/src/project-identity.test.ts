import { describe, expect, it } from 'vitest';
import { detectProjectIdentity, normalizeGitRemoteUrl, readProjectProfile } from './project-identity.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

describe('project identity', () => {
  it('normalizes common git remote urls into repo ids', () => {
    expect(normalizeGitRemoteUrl('git@github.com:MoMeak9/I-Evolve.git')).toBe('MoMeak9/I-Evolve');
    expect(normalizeGitRemoteUrl('https://github.com/MoMeak9/I-Evolve.git')).toBe('MoMeak9/I-Evolve');
  });

  it('detects repo id from git remote and package names from workspace', () => {
    const dir = join('/tmp', `ie-ident-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/editor.git'], { cwd: dir });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/editor' }), 'utf-8');

    const identity = detectProjectIdentity({ cwd: dir });

    expect(identity.repoId).toBe('acme/editor');
    expect(identity.gitRemote).toBe('git@github.com:acme/editor.git');
    expect(identity.packageNames).toContain('@acme/editor');
    expect(identity.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('uses project profile to infer project and domain', () => {
    const profile = readProjectProfile([
      '---',
      'id: project.demo.profile',
      'type: project_profile',
      'project_id: demo-project',
      'repo_ids:',
      '  - acme/editor',
      'domains:',
      '  - web-editor',
      'package_names:',
      '  - "@acme/editor"',
      'status: active',
      '---',
      '',
    ].join('\n'));

    const identity = detectProjectIdentity({
      cwd: '/tmp/acme-editor',
      gitRemote: 'git@github.com:acme/editor.git',
      packageNames: ['@acme/editor'],
      profiles: [profile],
    });

    expect(identity.projectId).toBe('demo-project');
    expect(identity.domain).toBe('web-editor');
  });
});
