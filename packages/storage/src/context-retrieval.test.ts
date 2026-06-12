import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MarkdownMemoryRepository } from './memory-repository.js';
import { retrieveContext, formatContextMarkdown } from './context-retrieval.js';

const testDir = join('/tmp', `ie-ctx-${randomBytes(4).toString('hex')}`);
let repo: MarkdownMemoryRepository;

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  repo = new MarkdownMemoryRepository({
    memoryDir: join(testDir, 'memory'),
    dbPath: join(testDir, 'index.db'),
  });
});

afterEach(() => {
  repo.close();
  rmSync(testDir, { recursive: true, force: true });
});

function seed() {
  repo.create({
    id: 'project.demo.fact-one', type: 'project_fact', scope: 'project', projectId: 'demo',
    title: 'Project Fact One', content: 'A project fact.', status: 'active', visibility: 'team',
    confidence: 0.9, ttlDays: 365, tags: [], sourceRefs: [],
  });
  repo.create({
    id: 'global.read-before-edit', type: 'workflow_rule', scope: 'global',
    title: 'Read before edit', content: 'Read files before editing.', status: 'active', visibility: 'public',
    confidence: 0.88, ttlDays: 180, tags: [], sourceRefs: [],
  });
  repo.create({
    id: 'project.demo.pitfall-one', type: 'pitfall', scope: 'project', projectId: 'demo',
    title: 'Known Pitfall', content: 'Watch out for X.', status: 'active', visibility: 'team',
    confidence: 0.8, ttlDays: 90, tags: [], sourceRefs: [],
  });
}

describe('retrieveContext', () => {
  it('returns active memories matching scope', () => {
    seed();
    const result = retrieveContext(repo, { projectId: 'demo' });
    expect(result.project).toHaveLength(1);
    expect(result.global).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('excludes deprecated memories', () => {
    seed();
    repo.forget('project.demo.fact-one', 'soft');
    const result = retrieveContext(repo, { projectId: 'demo' });
    expect(result.project).toHaveLength(0);
  });

  it('excludes memories with non-matching scope', () => {
    seed();
    const result = retrieveContext(repo, { projectId: 'other-project' });
    expect(result.project).toHaveLength(0);
    // global still applies
    expect(result.global).toHaveLength(1);
  });

  it('excludes expired memories', () => {
    repo.create({
      id: 'project.demo.expired', type: 'project_fact', scope: 'project', projectId: 'demo',
      title: 'Expired', content: 'Old.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 1, expiresAt: '2020-01-01T00:00:00.000Z', tags: [], sourceRefs: [],
    });
    const result = retrieveContext(repo, { projectId: 'demo', now: '2026-06-12T00:00:00.000Z' });
    expect(result.project).toHaveLength(0);
  });

  it('formats context as markdown', () => {
    seed();
    const result = retrieveContext(repo, { repoId: 'r', projectId: 'demo', domain: 'web' });
    const md = formatContextMarkdown({ repoId: 'r', projectId: 'demo', domain: 'web' }, result);
    expect(md).toContain('# I-Evolve Context');
    expect(md).toContain('project_id: demo');
    expect(md).toContain('id=project.demo.fact-one');
    expect(md).toContain('A project fact.');
    expect(md).toContain('Active Instincts');
    expect(md).toContain('Warnings');
  });
});
