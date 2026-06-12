import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MarkdownMemoryRepository, retrieveContext } from '../packages/storage/src/index.js';
import { decideScope } from '../packages/ai-evolution/src/judge/ScopeJudge.js';
import { Daemon } from '../packages/daemon/src/daemon.js';
import { sendRequest, DaemonNotRunningError } from '../packages/daemon/src/ipc-client.js';
import { setBasePath, paths } from '../packages/daemon/src/paths.js';

describe('pollution safeguards', () => {
  it('does not inject repo A memory into repo B without applies_to', () => {
    const dir = join('/tmp', `ie-pollution-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    const repo = new MarkdownMemoryRepository({ memoryDir: join(dir, 'memory'), dbPath: join(dir, 'index.db') });
    try {
      repo.create({
        id: 'repo.a.private-rule', type: 'repo_fact', scope: 'repo', repoId: 'org/repo-a',
        title: 'Private Rule', content: 'Only repo A.', status: 'active', visibility: 'team',
        confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      });
      const result = retrieveContext(repo, { repoId: 'org/repo-b' });
      expect(result.repo).toHaveLength(0);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows domain memory to cross related repositories', () => {
    const dir = join('/tmp', `ie-pollution-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    const repo = new MarkdownMemoryRepository({ memoryDir: join(dir, 'memory'), dbPath: join(dir, 'index.db') });
    try {
      repo.create({
        id: 'domain.ssr.hydration', type: 'workflow_rule', scope: 'domain', domain: 'ssr',
        title: 'Hydration Check', content: 'Check hydration issues.', status: 'active', visibility: 'team',
        confidence: 0.88, ttlDays: 180, tags: [], sourceRefs: [],
      });
      const result = retrieveContext(repo, { repoId: 'org/repo-b', domain: 'ssr' });
      expect(result.domain.map((m) => m.id)).toEqual(['domain.ssr.hydration']);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not inject deprecated or rejected memories', () => {
    withRepo((repo) => {
      repo.create({
        id: 'project.demo.deprecated', type: 'project_fact', scope: 'project', projectId: 'demo',
        title: 'Deprecated', content: 'Old rule.', status: 'active', visibility: 'team',
        confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      });
      repo.forget('project.demo.deprecated', 'soft');
      repo.create({
        id: 'project.demo.rejected', type: 'project_fact', scope: 'project', projectId: 'demo',
        title: 'Rejected', content: 'Bad rule.', status: 'rejected', visibility: 'team',
        confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      } as any);
      const result = retrieveContext(repo, { projectId: 'demo' });
      expect([...result.project, ...result.global, ...result.warnings].map((m) => m.id)).toEqual([]);
    });
  });

  it('does not promote task constraints to global scope', () => {
    const scoped = decideScope({
      id: 'candidate.task',
      type: 'task_constraint',
      proposedScope: 'global',
      title: 'Temporary',
      content: 'Only this task.',
      confidence: 0.9,
      visibility: 'team',
      tags: [],
      sourceRefs: [],
    } as any);

    expect(scoped.scope).toBe('task');
    expect(scoped.downgraded).toBe(true);
  });

  it('blocks secret or PII memory writes through daemon', async () => {
    const dir = join('/tmp', `ie-pollution-${randomBytes(4).toString('hex')}`);
    setBasePath(dir);
    const daemon = new Daemon();
    await daemon.start();
    try {
      const resp = await sendRequest({
        type: 'memory.remember',
        payload: { content: 'API key sk-1234567890abcdef should not be saved.', cwd: dir, projectId: 'demo' },
      } as any);
      expect(resp.ok).toBe(false);
      expect(resp.error?.code).toBe('SENSITIVE_MEMORY_BLOCKED');
    } finally {
      await daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails daemon write operations when daemon is not running', async () => {
    const dir = join('/tmp', `ie-pollution-${randomBytes(4).toString('hex')}`);
    setBasePath(dir);
    await expect(sendRequest({
      type: 'memory.remember',
      payload: { content: 'Should fail.', cwd: dir, projectId: 'demo' },
    } as any)).rejects.toBeInstanceOf(DaemonNotRunningError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects concurrent revision conflicts', () => {
    withRepo((repo) => {
      const memory = repo.create({
        id: 'project.demo.conflict', type: 'project_fact', scope: 'project', projectId: 'demo',
        title: 'Conflict', content: 'First.', status: 'active', visibility: 'team',
        confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      });
      repo.update(memory.id, { content: 'Second.' }, {
        expectedRevision: memory.revision,
        expectedContentHash: memory.contentHash,
      });
      expect(() => repo.update(memory.id, { content: 'Third.' }, {
        expectedRevision: memory.revision,
        expectedContentHash: memory.contentHash,
      })).toThrow(/Concurrency conflict/);
    });
  });
});

function withRepo(fn: (repo: MarkdownMemoryRepository) => void): void {
  const dir = join('/tmp', `ie-pollution-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const repo = new MarkdownMemoryRepository({ memoryDir: join(dir, 'memory'), dbPath: join(dir, 'index.db') });
  try {
    fn(repo);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
