import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GitMemorySync } from './git-memory-sync.js';
import { GitWorkspaceLock } from './workspace-lock.js';
import { validateMemoryRepo } from './validate.js';
import { readSchemaVersion, runMigrations, getMigrationStatus, type MigrationStep } from './migration.js';
import { computeContentHash } from '@i-evolve/storage';

const base = join('/tmp', `ie-git-${randomBytes(4).toString('hex')}`);
const remoteDir = join(base, 'remote.git');
const workDir = join(base, 'work');

function gitInit(dir: string, bare = false): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', bare ? ['init', '--bare'] : ['init'], { cwd: dir });
  if (!bare) {
    execFileSync('git', ['config', 'user.email', 'test@i-evolve.dev'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  }
}

function writePack(dir: string, version = 2): void {
  writeFileSync(join(dir, 'memory-pack.yaml'), `id: team.default\nschema_version: ${version}\n`, 'utf-8');
}

function writeMemory(dir: string, id: string, contentHash = computeContentHash('A project fact.')): void {
  const sub = join(dir, 'projects', 'demo');
  mkdirSync(sub, { recursive: true });
  const slug = id.split('.').pop();
  writeFileSync(join(sub, `${slug}.md`), [
    '---',
    `id: ${id}`,
    'type: project_fact',
    'scope: project',
    'project_id: demo',
    'title: A Fact',
    'status: active',
    'visibility: team',
    'confidence: 0.9',
    'revision: 1',
    `content_hash: ${contentHash}`,
    'created_at: 2026-06-12T10:00:00+08:00',
    'updated_at: 2026-06-12T10:00:00+08:00',
    '---',
    '',
    'A project fact.',
    '',
  ].join('\n'), 'utf-8');
}

beforeEach(() => {
  mkdirSync(base, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('GitWorkspaceLock', () => {
  it('acquires and releases', () => {
    gitInit(workDir);
    const lock = new GitWorkspaceLock(workDir);
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false); // already held
    lock.release();
    expect(lock.acquire()).toBe(true);
    lock.release();
  });
});

describe('GitMemorySync', () => {
  beforeEach(() => {
    gitInit(remoteDir, true);
    gitInit(workDir);
    execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd: workDir });
    writePack(workDir);
    writeMemory(workDir, 'project.demo.a-fact');
  });

  it('reports status with current commit', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): initial' });
    const status = sync.status();
    expect(status.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(status.clean).toBe(true);
  });

  it('commits memory changes', async () => {
    const sync = new GitMemorySync(workDir);
    const result = await sync.commit({ message: 'memory(auto): add a fact', decision: 'activate', confidence: 0.9 });
    expect(result.ok).toBe(true);
    expect(result.commit).toBeDefined();
    expect(sync.log()).toContain('add a fact');
  });

  it('blocks push when validation fails', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): initial' });
    // introduce a secret into a tracked memory
    writeFileSync(join(workDir, 'projects', 'demo', 'leak.md'), [
      '---', 'id: project.demo.leak', 'type: project_fact', 'scope: project',
      'project_id: demo', 'title: Leak', 'status: active', 'visibility: team',
      'confidence: 0.9', 'revision: 1', 'content_hash: sha256:x',
      'created_at: 2026-06-12T10:00:00+08:00', 'updated_at: 2026-06-12T10:00:00+08:00',
      '---', '', 'token AKIAABCDEFGHIJKLMNOP here', '',
    ].join('\n'), 'utf-8');
    const result = await sync.push();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('validation failed');
  });

  it('pushes when valid', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): initial' });
    const result = await sync.push();
    expect(result.ok).toBe(true);
  });

  it('audits push after validation succeeds', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): initial' });
    const audits: string[] = [];
    const result = await sync.push({
      appendAudit: (audit) => audits.push(`${audit.action}:${audit.actorType}`),
    });
    expect(result.ok).toBe(true);
    expect(audits).toEqual(['sync_push:system']);
  });

  it('rolls back via checkout', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): first' });
    const first = sync.status().commit;
    writeMemory(workDir, 'project.demo.second-fact');
    await sync.commit({ message: 'memory(auto): second' });
    const result = await sync.rollback({ toCommit: first, mode: 'checkout' });
    expect(result.ok).toBe(true);
    expect(result.commit).toBe(first);
  });

  it('rebuilds index and audits pull while holding git workspace lock', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): initial' });
    await sync.push();

    const other = join(base, 'other');
    execFileSync('git', ['clone', remoteDir, other]);
    execFileSync('git', ['config', 'user.email', 'test@i-evolve.dev'], { cwd: other });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: other });
    writeMemory(other, 'project.demo.remote-fact');
    execFileSync('git', ['add', '-A'], { cwd: other });
    execFileSync('git', ['commit', '-m', 'memory(auto): remote fact'], { cwd: other });
    execFileSync('git', ['push'], { cwd: other });

    const events: string[] = [];
    const result = await sync.pull({
      rebuildIndex: () => {
        events.push(existsSync(join(workDir, '.git', 'i-evolve.lock')) ? 'rebuild:locked' : 'rebuild:unlocked');
      },
      appendAudit: (audit) => {
        events.push(`${audit.action}:${audit.actorType}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual(['rebuild:locked', 'sync_pull:system']);
  });

  it('audits rollback and rebuilds index while holding git workspace lock', async () => {
    const sync = new GitMemorySync(workDir);
    await sync.commit({ message: 'memory(auto): first' });
    const first = sync.status().commit;
    writeMemory(workDir, 'project.demo.second-fact');
    await sync.commit({ message: 'memory(auto): second' });

    const events: string[] = [];
    const result = await sync.rollback({
      toCommit: first,
      mode: 'checkout',
      rebuildIndex: () => {
        events.push(existsSync(join(workDir, '.git', 'i-evolve.lock')) ? 'rebuild:locked' : 'rebuild:unlocked');
      },
      appendAudit: (audit) => {
        events.push(`${audit.action}:${audit.beforeHash?.slice(0, 7)}:${audit.afterHash?.slice(0, 7)}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual([`rebuild:locked`, `rollback:${result.previousCommit?.slice(0, 7)}:${first.slice(0, 7)}`]);
  });
});

describe('GitMemorySync.attach', () => {
  const seedDir = join(base, 'seed');
  const targetDir = join(base, 'target');

  // Build a non-empty remote with shared.md + projects/remote.md on the default branch.
  function buildPopulatedRemote(): void {
    mkdirSync(remoteDir, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: remoteDir });
    gitInit(seedDir);
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
    execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd: seedDir });
    writeFileSync(join(seedDir, 'shared.md'), 'remote-version\n', 'utf-8');
    mkdirSync(join(seedDir, 'projects'), { recursive: true });
    writeFileSync(join(seedDir, 'projects', 'remote.md'), 'remote-only\n', 'utf-8');
    execFileSync('git', ['add', '-A'], { cwd: seedDir });
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: seedDir });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: seedDir });
  }

  it('clones into an empty directory', () => {
    buildPopulatedRemote();
    mkdirSync(targetDir, { recursive: true });
    const result = new GitMemorySync(targetDir).attach(remoteDir);
    expect(result.ok).toBe(true);
    expect(result.collisions).toEqual([]);
    expect(existsSync(join(targetDir, '.git'))).toBe(true);
    expect(existsSync(join(targetDir, 'shared.md'))).toBe(true);
  });

  it('merges into a non-empty directory, keeping remote on collisions and restoring local-only files', () => {
    buildPopulatedRemote();
    mkdirSync(join(targetDir, 'projects'), { recursive: true });
    writeFileSync(join(targetDir, 'shared.md'), 'local-version\n', 'utf-8'); // collides
    writeFileSync(join(targetDir, 'projects', 'local.md'), 'local-only\n', 'utf-8'); // unique

    const result = new GitMemorySync(targetDir).attach(remoteDir);

    expect(result.ok).toBe(true);
    expect(result.collisions).toEqual(['shared.md']);
    expect(result.restored).toContain(join('projects', 'local.md'));
    // Remote wins on the colliding path.
    expect(readFileSync(join(targetDir, 'shared.md'), 'utf-8')).toBe('remote-version\n');
    // Remote-only file is present.
    expect(existsSync(join(targetDir, 'projects', 'remote.md'))).toBe(true);
    // Local-only file is restored.
    expect(readFileSync(join(targetDir, 'projects', 'local.md'), 'utf-8')).toBe('local-only\n');
    expect(existsSync(join(targetDir, '.git'))).toBe(true);
  });

  it('is a no-op when already initialized', () => {
    buildPopulatedRemote();
    mkdirSync(targetDir, { recursive: true });
    new GitMemorySync(targetDir).attach(remoteDir);
    const second = new GitMemorySync(targetDir).attach(remoteDir);
    expect(second.message).toBe('already initialized');
  });

  it('rolls back local files when the clone fails', () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'keep.md'), 'precious\n', 'utf-8');
    expect(() => new GitMemorySync(targetDir).attach(join(base, 'does-not-exist.git'))).toThrow();
    // Original file survives the failed attach.
    expect(readFileSync(join(targetDir, 'keep.md'), 'utf-8')).toBe('precious\n');
    expect(existsSync(join(targetDir, '.git'))).toBe(false);
  });
});

describe('validateMemoryRepo', () => {
  beforeEach(() => {
    mkdirSync(workDir, { recursive: true });
    writePack(workDir);
  });

  it('passes a clean repo', () => {
    writeMemory(workDir, 'project.demo.a-fact');
    const report = validateMemoryRepo(workDir);
    expect(report.ok).toBe(true);
    expect(report.checkedFiles).toBe(1);
  });

  it('detects secrets', () => {
    const sub = join(workDir, 'projects', 'demo');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'leak.md'), [
      '---', 'id: project.demo.leak', 'type: project_fact', 'scope: project',
      'project_id: demo', 'title: Leak', 'status: active', 'visibility: team',
      'confidence: 0.9', 'revision: 1', 'content_hash: sha256:x',
      'created_at: 2026-06-12T10:00:00+08:00', 'updated_at: 2026-06-12T10:00:00+08:00',
      '---', '', 'AKIAABCDEFGHIJKLMNOP', '',
    ].join('\n'), 'utf-8');
    const report = validateMemoryRepo(workDir);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.problem.includes('secret'))).toBe(true);
  });

  it('detects missing memory-pack.yaml', () => {
    rmSync(join(workDir, 'memory-pack.yaml'));
    const report = validateMemoryRepo(workDir);
    expect(report.issues.some((i) => i.file === 'memory-pack.yaml')).toBe(true);
  });

  it('detects unreadable schema version', () => {
    writeFileSync(join(workDir, 'memory-pack.yaml'), 'id: team.default\nschema_version: future\n', 'utf-8');
    const report = validateMemoryRepo(workDir);
    expect(report.issues.some((i) => i.problem.includes('schema_version'))).toBe(true);
  });

  it('detects duplicate ids', () => {
    writeMemory(workDir, 'project.demo.dup');
    const sub = join(workDir, 'projects', 'demo');
    writeFileSync(join(sub, 'dup2.md'), [
      '---', 'id: project.demo.dup', 'type: project_fact', 'scope: project',
      'project_id: demo', 'title: Dup', 'status: active', 'visibility: team',
      'confidence: 0.9', 'revision: 1', 'content_hash: sha256:x',
      'created_at: 2026-06-12T10:00:00+08:00', 'updated_at: 2026-06-12T10:00:00+08:00',
      '---', '', 'Duplicate id.', '',
    ].join('\n'), 'utf-8');
    const report = validateMemoryRepo(workDir);
    expect(report.issues.some((i) => i.problem.includes('duplicate id'))).toBe(true);
  });

  it('detects content hash mismatch', () => {
    writeMemory(workDir, 'project.demo.hash-mismatch', 'sha256:abc123');
    const report = validateMemoryRepo(workDir);
    expect(report.issues.some((i) => i.problem.includes('content_hash mismatch'))).toBe(true);
  });

  it('detects expired active memory', () => {
    const sub = join(workDir, 'projects', 'demo');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'expired.md'), [
      '---', 'id: project.demo.expired', 'type: project_fact', 'scope: project',
      'project_id: demo', 'title: Expired', 'status: active', 'visibility: team',
      'confidence: 0.9', 'revision: 1', 'content_hash: sha256:x',
      'expires_at: 2020-01-01T00:00:00.000Z',
      'created_at: 2026-06-12T10:00:00+08:00', 'updated_at: 2026-06-12T10:00:00+08:00',
      '---', '', 'Expired id.', '',
    ].join('\n'), 'utf-8');
    const report = validateMemoryRepo(workDir, { now: '2026-06-12T00:00:00.000Z' });
    expect(report.issues.some((i) => i.problem.includes('active memory expired'))).toBe(true);
  });

  it('detects PII and tombstone id reuse', () => {
    writeMemory(workDir, 'project.demo.reused');
    const tombstones = join(workDir, 'tombstones');
    mkdirSync(tombstones, { recursive: true });
    writeFileSync(join(tombstones, 'project.demo.reused.md'), 'tombstone', 'utf-8');
    const piiFile = join(workDir, 'projects', 'demo', 'pii.md');
    writeFileSync(piiFile, [
      '---', 'id: project.demo.pii', 'type: project_fact', 'scope: project',
      'project_id: demo', 'title: PII', 'status: active', 'visibility: team',
      'confidence: 0.9', 'revision: 1', 'content_hash: sha256:x',
      'created_at: 2026-06-12T10:00:00+08:00', 'updated_at: 2026-06-12T10:00:00+08:00',
      '---', '', 'Contact me at person@example.com.', '',
    ].join('\n'), 'utf-8');
    const report = validateMemoryRepo(workDir);
    expect(report.issues.some((i) => i.problem.includes('tombstone'))).toBe(true);
    expect(report.issues.some((i) => i.problem.includes('PII'))).toBe(true);
  });
});

describe('migrations', () => {
  beforeEach(() => {
    mkdirSync(workDir, { recursive: true });
    writePack(workDir, 1);
  });

  it('reads schema version', () => {
    expect(readSchemaVersion(workDir)).toBe(1);
  });

  it('dry-run does not write files or bump version', async () => {
    const steps: MigrationStep[] = [{ id: '002', description: 'noop', apply: () => ['x.md'] }];
    const result = await runMigrations(workDir, steps, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.applied).toEqual(['002']);
    expect(readSchemaVersion(workDir)).toBe(1); // unchanged
  });

  it('run applies steps and bumps version', async () => {
    const applied: string[] = [];
    const steps: MigrationStep[] = [{ id: '002', description: 'noop', apply: () => { applied.push('ran'); return ['x.md']; } }];
    const result = await runMigrations(workDir, steps);
    expect(result.toVersion).toBe(2);
    expect(applied).toEqual(['ran']);
    expect(readSchemaVersion(workDir)).toBe(2);
  });

  it('run applies steps under lock and creates a migration commit', async () => {
    gitInit(workDir);
    writePack(workDir, 1);
    execFileSync('git', ['add', '-A'], { cwd: workDir });
    execFileSync('git', ['commit', '-m', 'memory(auto): initial'], { cwd: workDir });

    const steps: MigrationStep[] = [{
      id: '002',
      description: 'add changelog',
      apply: (repoDir) => {
        expect(existsSync(join(repoDir, '.git', 'i-evolve.lock'))).toBe(true);
        writeFileSync(join(repoDir, 'CHANGELOG.md'), 'migrated\n', 'utf-8');
        return ['CHANGELOG.md'];
      },
    }];

    const audits: string[] = [];
    const result = await runMigrations(workDir, steps, {
      appendAudit: (audit) => audits.push(`${audit.action}:${audit.actorId}`),
    });

    expect(result.applied).toEqual(['002']);
    expect(readSchemaVersion(workDir)).toBe(2);
    expect(readFileSync(join(workDir, 'CHANGELOG.md'), 'utf-8')).toContain('migrated');
    expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: workDir, encoding: 'utf-8' }).trim())
      .toBe('memory(system): migrate schema to 2');
    expect(audits).toEqual(['migrate:i-evolve-migration']);
  });

  it('reports pending migrations', () => {
    const steps: MigrationStep[] = [{ id: '002', description: 'pending', apply: () => [] }];
    const status = getMigrationStatus(workDir, steps);
    expect(status.currentVersion).toBe(1);
    expect(status.pending).toHaveLength(1);
  });
});
