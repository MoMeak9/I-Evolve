import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarkdownMemoryRepository } from './memory-repository.js';

let tmpDir: string;
let repo: MarkdownMemoryRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ie-retrospection-'));
  repo = new MarkdownMemoryRepository({
    memoryDir: join(tmpDir, 'memory'),
    dbPath: join(tmpDir, 'index.db'),
  });
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeCandidate(id: string, title: string, overrides?: Partial<object>) {
  return repo.create({
    id,
    type: 'repo_fact' as const,
    scope: 'global' as const,
    title,
    content: `Candidate content for ${title}`,
    status: 'candidate' as const,
    visibility: 'private' as const,
    confidence: 0.6,
    ttlDays: null,
    expiresAt: null,
    tags: ['test'],
    sourceRefs: ['session.test'],
    ...overrides,
  });
}

describe('countCandidatesBySlug', () => {
  it('returns 0 for an unknown slug', () => {
    expect(repo.countCandidatesBySlug('no-such-slug')).toBe(0);
  });

  it('counts candidate memories matching the title slug', () => {
    makeCandidate('test.cand.one', 'My Important Finding');
    makeCandidate('test.cand.two', 'My Important Finding');
    expect(repo.countCandidatesBySlug('my-important-finding')).toBe(2);
  });

  it('does not count active memories with matching title slug', () => {
    makeCandidate('test.cand.active', 'Active Title', { status: 'active' as const });
    makeCandidate('test.cand.cand', 'Active Title');
    expect(repo.countCandidatesBySlug('active-title')).toBe(1);
  });
});

describe('promoteCandidatesBySlug', () => {
  it('returns null when no candidates exist for the slug', () => {
    const result = repo.promoteCandidatesBySlug('no-such-slug', 'new content', 'test.promoted.new');
    expect(result).toBeNull();
  });

  it('promotes candidates: creates new active memory, old candidates become rejected', () => {
    makeCandidate('test.promo.cand1', 'Key Insight');
    makeCandidate('test.promo.cand2', 'Key Insight');

    const promoted = repo.promoteCandidatesBySlug('key-insight', 'Final promoted content', 'test.promo.active');

    expect(promoted).not.toBeNull();
    expect(promoted!.id).toBe('test.promo.active');
    expect(promoted!.status).toBe('active');
    expect(promoted!.content).toBe('Final promoted content');
    expect(promoted!.title).toBe('Key Insight');

    // Old candidates should now be rejected
    const cand1 = repo.get('test.promo.cand1');
    const cand2 = repo.get('test.promo.cand2');
    expect(cand1?.status).toBe('rejected');
    expect(cand2?.status).toBe('rejected');

    // Candidate count for this slug should now be 0
    expect(repo.countCandidatesBySlug('key-insight')).toBe(0);
  });

  it('bumps confidence by 0.1 on the promoted memory', () => {
    makeCandidate('test.conf.cand', 'Confidence Test');

    const promoted = repo.promoteCandidatesBySlug('confidence-test', 'Promoted content', 'test.conf.active');
    expect(promoted!.confidence).toBeCloseTo(0.7);
  });
});
