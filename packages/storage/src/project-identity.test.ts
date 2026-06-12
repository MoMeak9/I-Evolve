import { describe, expect, it } from 'vitest';
import {
  bindProjectIdentity,
  detectProjectIdentity,
  normalizeGitRemoteUrl,
  readProjectProfile,
} from './project-identity.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('detects package names from go.mod and pnpm workspace packages', () => {
    const dir = join('/tmp', `ie-ident-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(dir, 'packages', 'web'), { recursive: true });
    writeFileSync(join(dir, 'go.mod'), 'module github.com/acme/backend\n', 'utf-8');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf-8');
    writeFileSync(join(dir, 'packages', 'web', 'package.json'), JSON.stringify({ name: '@acme/web' }), 'utf-8');

    const identity = detectProjectIdentity({ cwd: dir });

    expect(identity.packageNames).toContain('github.com/acme/backend');
    expect(identity.packageNames).toContain('@acme/web');
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists manual identity bindings as project profiles', () => {
    const memoryDir = join('/tmp', `ie-bind-${randomBytes(4).toString('hex')}`);
    const profilePath = bindProjectIdentity({
      memoryDir,
      projectId: 'demo-project',
      repoId: 'acme/editor',
      domain: 'web-editor',
      packageNames: ['@acme/editor'],
    });

    expect(existsSync(profilePath)).toBe(true);
    const profile = readProjectProfile(readFileSync(profilePath, 'utf-8'));
    expect(profile.projectId).toBe('demo-project');
    expect(profile.repoIds).toContain('acme/editor');
    expect(profile.domains).toContain('web-editor');
    rmSync(memoryDir, { recursive: true, force: true });
  });
});
