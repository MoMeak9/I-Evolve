import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MarkdownMemoryRepository } from './memory-repository.js';
import { retrieveContext, formatContextMarkdown, retrieveContextDebug } from './context-retrieval.js';
import { SqliteIndex } from './sqlite-index.js';

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
    id: 'repo.acme-demo.fact-one', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
    title: 'Project Fact One', content: 'A project fact.', status: 'active', visibility: 'team',
    confidence: 0.9, ttlDays: 365, tags: [], sourceRefs: [],
  });
  repo.create({
    id: 'global.read-before-edit', type: 'workflow_rule', scope: 'global',
    title: 'Read before edit', content: 'Read files before editing.', status: 'active', visibility: 'public',
    confidence: 0.88, ttlDays: 180, tags: [], sourceRefs: [],
  });
  repo.create({
    id: 'repo.acme-demo.pitfall-one', type: 'pitfall', scope: 'repo', repoId: 'acme/demo',
    title: 'Known Pitfall', content: 'Watch out for X.', status: 'active', visibility: 'team',
    confidence: 0.8, ttlDays: 90, tags: [], sourceRefs: [],
  });
}

describe('retrieveContext', () => {
  it('returns active memories matching scope', () => {
    seed();
    const result = retrieveContext(repo, { repoId: 'acme/demo' });
    expect(result.repo).toHaveLength(1);
    expect(result.global).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('excludes deprecated memories', () => {
    seed();
    repo.forget('repo.acme-demo.fact-one', 'soft');
    const result = retrieveContext(repo, { repoId: 'acme/demo' });
    expect(result.repo).toHaveLength(0);
  });

  it('excludes memories with non-matching scope', () => {
    seed();
    const result = retrieveContext(repo, { repoId: 'other/repo' });
    expect(result.repo).toHaveLength(0);
    // global still applies
    expect(result.global).toHaveLength(1);
  });

  it('excludes expired memories', () => {
    repo.create({
      id: 'repo.acme-demo.expired', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'Expired', content: 'Old.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 1, expiresAt: '2020-01-01T00:00:00.000Z', tags: [], sourceRefs: [],
    });
    const result = retrieveContext(repo, { repoId: 'acme/demo', now: '2026-06-12T00:00:00.000Z' });
    expect(result.repo).toHaveLength(0);
  });

  it('formats context as markdown', () => {
    seed();
    const result = retrieveContext(repo, { repoId: 'r', domain: 'web' });
    const md = formatContextMarkdown({ repoId: 'r', domain: 'web' }, result);
    expect(md).toContain('# I-Evolve Context');
    expect(md).toContain('repo_id: r');
    expect(md).toContain('id=global.read-before-edit');
    expect(md).toContain('Active Instincts');
  });

  it('allows repo memory to cross repos only through applies_to', () => {
    repo.create({
      id: 'repo.acme-editor.cross-repo', type: 'repo_fact', scope: 'repo', repoId: 'acme/editor',
      title: 'Cross Repo', content: 'Applies to sibling repos.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      appliesTo: { repoPatterns: ['acme/*'] },
    });
    repo.create({
      id: 'repo.other.no-cross', type: 'repo_fact', scope: 'repo', repoId: 'other/repo',
      title: 'No Cross', content: 'Must not cross without applies_to.', status: 'active', visibility: 'team',
      confidence: 0.95, ttlDays: 90, tags: [], sourceRefs: [],
    });

    const result = retrieveContext(repo, { repoId: 'acme/admin' });
    expect(result.repo.map((m) => m.id)).toContain('repo.acme-editor.cross-repo');
    expect(result.repo.map((m) => m.id)).not.toContain('repo.other.no-cross');
  });

  it('suppresses lower-priority conflicts with the same topic', () => {
    repo.create({
      id: 'repo.acme-editor.read-before-edit', type: 'workflow_rule', scope: 'repo', repoId: 'acme/editor',
      title: 'Read Before Edit', content: 'Repo specific read rule.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 90, tags: ['read-before-edit'], sourceRefs: [],
    });
    repo.create({
      id: 'repo.demo.read-before-edit-high', type: 'workflow_rule', scope: 'repo', repoId: 'acme/editor',
      title: 'Read Before Edit', content: 'Project read rule.', status: 'active', visibility: 'team',
      confidence: 0.99, ttlDays: 90, tags: ['read-before-edit'], sourceRefs: [],
    });

    const debug = retrieveContextDebug(repo, { repoId: 'acme/editor' });
    expect(debug.retrieved.repo.map((m) => m.id)).toEqual(['repo.demo.read-before-edit-high']);
    expect(debug.retrieved.repo.map((m) => m.id)).not.toContain('repo.acme-editor.read-before-edit');
    expect(debug.conflicts[0].selectedMemoryId).toBe('repo.demo.read-before-edit-high');
    expect(debug.conflicts[0].suppressedMemoryIds).toContain('repo.acme-editor.read-before-edit');
  });

  it('returns debug filter counters', () => {
    seed();
    repo.forget('repo.acme-demo.fact-one', 'soft');
    const debug = retrieveContextDebug(repo, { repoId: 'other/repo' });
    expect(debug.stats.candidates).toBeGreaterThan(0);
    expect(debug.stats.filteredDeprecated).toBeGreaterThanOrEqual(1);
    expect(debug.stats.filteredScopeMismatch).toBeGreaterThanOrEqual(1);
    expect(debug.stats.injected).toBe(debug.retrieved.global.length + debug.retrieved.warnings.length);
  });

  it('uses FTS query score to order matches within a scope', () => {
    repo.create({
      id: 'repo.acme-demo.react-low', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'Generic UI', content: 'React appears once.', status: 'active', visibility: 'team',
      confidence: 0.6, ttlDays: 90, tags: [], sourceRefs: [],
    });
    repo.create({
      id: 'repo.acme-demo.react-high', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'React React Hydration', content: 'React hydration React SSR React.', status: 'active', visibility: 'team',
      confidence: 0.6, ttlDays: 90, tags: [], sourceRefs: [],
    });

    const result = retrieveContext(repo, { repoId: 'acme/demo', query: 'React hydration' });
    expect(result.repo.map((m) => m.id)[0]).toBe('repo.acme-demo.react-high');
  });

  it('keeps recent session summaries as a Top 2 bucket', () => {
    for (let i = 1; i <= 3; i++) {
      repo.create({
        id: `repo.acme-demo.session-${i}`, type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
        title: `Session ${i}`, content: `Recent session summary ${i}.`, status: 'active', visibility: 'team',
        confidence: 0.7 + i / 100, ttlDays: 7, tags: ['session-summary'], sourceRefs: [`session-summary.${i}`],
      });
    }

    const result = retrieveContext(repo, { repoId: 'acme/demo' });
    expect(result.recent.map((m) => m.id)).toEqual(['repo.acme-demo.session-3', 'repo.acme-demo.session-2']);
    expect(formatContextMarkdown({ repoId: 'acme/demo' }, result)).toContain('Recent Session Summaries');
  });

  it('matches double-star path globs across directories', () => {
    repo.create({
      id: 'repo.acme.deep-path', type: 'repo_fact', scope: 'repo', repoId: 'acme/editor',
      title: 'Deep Path', content: 'Applies deeply.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 90, tags: [], sourceRefs: [],
      appliesTo: { pathPatterns: ['src/**/*.tsx'] },
    });

    const result = retrieveContext(repo, { path: 'src/features/editor/index.tsx' });
    expect(result.repo.map((m) => m.id)).toContain('repo.acme.deep-path');
  });

  it('does not suppress unrelated memories that only share a generic tag', () => {
    repo.create({
      id: 'repo.acme-demo.react-api', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'React API', content: 'Use API pattern.', status: 'active', visibility: 'team',
      confidence: 0.9, ttlDays: 90, tags: ['react'], sourceRefs: [],
    });
    repo.create({
      id: 'repo.acme-demo.react-build', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'React Build', content: 'Use build pattern.', status: 'active', visibility: 'team',
      confidence: 0.8, ttlDays: 90, tags: ['react'], sourceRefs: [],
    });

    const result = retrieveContextDebug(repo, { repoId: 'acme/demo' });
    expect(result.retrieved.repo.map((m) => m.id)).toEqual([
      'repo.acme-demo.react-api',
      'repo.acme-demo.react-build',
    ]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('blends dense vector signal into hybrid score (spec formula)', () => {
    repo.create({
      id: 'repo.acme-demo.alpha', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'Alpha', content: 'alpha content', status: 'active', visibility: 'team',
      confidence: 0.5, tags: [], sourceRefs: [],
    });
    repo.create({
      id: 'repo.acme-demo.beta', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'Beta', content: 'beta content', status: 'active', visibility: 'team',
      confidence: 0.5, tags: [], sourceRefs: [],
    });
    const index = new SqliteIndex(join(testDir, 'index.db'));
    index.upsertVectors([
      { chunkId: 'a1', memoryId: 'repo.acme-demo.alpha', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h', vector: new Float32Array([1, 0]), indexedAt: '2026-06-18T00:00:00.000Z' },
      { chunkId: 'b1', memoryId: 'repo.acme-demo.beta', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h', vector: new Float32Array([0, 1]), indexedAt: '2026-06-18T00:00:00.000Z' },
    ]);
    const result = retrieveContextDebug(repo, { repoId: 'acme/demo' }, undefined, {
      index, modelId: 'lite', queryVector: new Float32Array([1, 0]),
    });
    index.close();
    const repoIds = result.retrieved.repo.map((m) => m.id);
    expect(repoIds[0]).toBe('repo.acme-demo.alpha');
  });

  it('degrades to non-dense ordering when no provider/vector given', () => {
    repo.create({
      id: 'repo.acme-demo.x', type: 'repo_fact', scope: 'repo', repoId: 'acme/demo',
      title: 'X', content: 'x', status: 'active', visibility: 'team',
      confidence: 0.9, tags: [], sourceRefs: [],
    });
    const result = retrieveContextDebug(repo, { repoId: 'acme/demo' });
    expect(result.retrieved.repo.map((m) => m.id)).toContain('repo.acme-demo.x');
  });
});
