import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MarkdownMemoryRepository, retrieveContext } from '../packages/storage/src/index.js';

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
});
