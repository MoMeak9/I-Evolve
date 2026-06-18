import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MarkdownMemoryRepository } from './memory-repository.js';
import type { MemoryItem } from '@i-evolve/core';

const testDir = join('/tmp', `ie-storage-${randomBytes(4).toString('hex')}`);
const memoryDir = join(testDir, 'memory');
const dbPath = join(testDir, 'index.db');

let repo: MarkdownMemoryRepository;

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  repo = new MarkdownMemoryRepository({ memoryDir, dbPath });
});

afterEach(() => {
  repo.close();
  rmSync(testDir, { recursive: true, force: true });
});

function makeInput() {
  return {
    id: 'project.test.sample-memory',
    type: 'repo_fact' as const,
    scope: 'repo' as const,
    repoId: 'acme/test',
    title: 'Sample Memory',
    content: 'This is a test memory content.',
    status: 'active' as const,
    visibility: 'team' as const,
    confidence: 0.85,
    ttlDays: 180,
    tags: ['test', 'sample'],
    sourceRefs: ['session.20260612.xyz'],
    appliesTo: { repoPatterns: ['test/*'] },
  };
}

describe('MarkdownMemoryRepository', () => {
  it('creates memory and writes markdown file', () => {
    const memory = repo.create(makeInput());
    expect(memory.id).toBe('project.test.sample-memory');
    expect(memory.revision).toBe(1);
    expect(memory.contentHash).toMatch(/^sha256:/);
    expect(memory.createdAt).toBeDefined();

    // File should exist
    const listed = repo.list({ status: 'active' });
    expect(listed.length).toBe(1);
    expect(listed[0].title).toBe('Sample Memory');
  });

  it('creates memory and indexes in SQLite + FTS', () => {
    repo.create(makeInput());
    const results = repo.search('test memory');
    expect(results.length).toBe(1);
    expect(results[0].memory.id).toBe('project.test.sample-memory');
  });

  it('search with empty/whitespace query returns [] instead of throwing', () => {
    repo.create(makeInput());
    expect(() => repo.search('')).not.toThrow();
    expect(repo.search('')).toEqual([]);
    expect(repo.search('   ')).toEqual([]);
  });

  it('search tolerates FTS5 special characters (dot, dash, colon, quotes)', () => {
    repo.create(makeInput());
    // These all raised `fts5: syntax error` before sanitization.
    expect(() => repo.search('eva3.0')).not.toThrow();
    expect(() => repo.search('a-b:c')).not.toThrow();
    expect(() => repo.search('"unterminated')).not.toThrow();
    expect(() => repo.search('.')).not.toThrow();
    expect(repo.search('.')).toEqual([]);
  });

  it('search still matches when query is wrapped in punctuation', () => {
    repo.create(makeInput());
    // "test" lives in content/tags; surrounding punctuation must not break it.
    const results = repo.search('(test).');
    expect(results.length).toBe(1);
    expect(results[0].memory.id).toBe('project.test.sample-memory');
  });

  it('update with correct revision succeeds', () => {
    const memory = repo.create(makeInput());
    const updated = repo.update(memory.id, { title: 'Updated Title' }, {
      expectedRevision: 1,
      expectedContentHash: memory.contentHash,
    });
    expect(updated.revision).toBe(2);
    expect(updated.title).toBe('Updated Title');
  });

  it('update with wrong revision throws conflict', () => {
    const memory = repo.create(makeInput());
    expect(() => repo.update(memory.id, { title: 'X' }, {
      expectedRevision: 99,
      expectedContentHash: memory.contentHash,
    })).toThrow(/conflict/i);
  });

  it('update with wrong content hash throws conflict', () => {
    const memory = repo.create(makeInput());
    expect(() => repo.update(memory.id, { title: 'X' }, {
      expectedRevision: 1,
      expectedContentHash: 'sha256:wrong',
    })).toThrow(/conflict/i);
  });

  it('changeStatus follows valid transitions', () => {
    const input = { ...makeInput(), status: 'candidate' as const };
    const memory = repo.create(input);
    const activated = repo.changeStatus(memory.id, 'active', { expectedRevision: 1 });
    expect(activated.status).toBe('active');
  });

  it('changeStatus rejects invalid transition', () => {
    const input = { ...makeInput(), status: 'candidate' as const };
    const memory = repo.create(input);
    expect(() => repo.changeStatus(memory.id, 'deprecated', { expectedRevision: 1 }))
      .toThrow(/invalid status transition/i);
  });

  it('soft forget marks as deprecated', () => {
    const memory = repo.create(makeInput());
    repo.forget(memory.id, 'soft');
    const result = repo.get(memory.id);
    expect(result?.status).toBe('deprecated');
  });

  it('tombstone removes from index', () => {
    const memory = repo.create(makeInput());
    repo.forget(memory.id, 'tombstone');
    const result = repo.get(memory.id);
    expect(result).toBeNull();
    expect(existsSync(join(memoryDir, 'tombstones', `${memory.id}.md`))).toBe(true);
  });

  it('deprecated memory not returned by search', () => {
    const memory = repo.create(makeInput());
    repo.forget(memory.id, 'soft');
    const results = repo.search('test');
    expect(results.length).toBe(0);
  });

  it('expired active memory not returned by search', () => {
    repo.create({
      ...makeInput(),
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const results = repo.search('test memory');
    expect(results.length).toBe(0);
  });

  it('rejects recreating a tombstoned memory id', () => {
    const memory = repo.create(makeInput());
    repo.forget(memory.id, 'tombstone');
    expect(() => repo.create(makeInput())).toThrow(/tombstone/i);
  });

  it('rebuildIndex restores from markdown files', () => {
    repo.create(makeInput());
    repo.create({
      ...makeInput(),
      id: 'project.test.second-memory',
      title: 'Second Memory',
      content: 'Another test.',
    });

    // Simulate index loss by clearing
    const { total, errors } = repo.rebuildIndex();
    expect(total).toBe(2);
    expect(errors).toBe(0);

    const results = repo.search('test');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('rebuildIndex skips invalid markdown files', () => {
    repo.create(makeInput());
    const badDir = join(memoryDir, 'projects', 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'bad.md'), [
      '---',
      'id: project.bad.invalid',
      'type: repo_fact',
      'scope: repo',
      'repo_id: bad',
      'title: Invalid',
      'status: active',
      'visibility: team',
      'confidence: 2',
      'revision: 1',
      'content_hash: sha256:bad',
      'created_at: 2026-06-12T10:00:00.000Z',
      'updated_at: 2026-06-12T10:00:00.000Z',
      '---',
      '',
      'Invalid memory.',
      '',
    ].join('\n'), 'utf-8');

    const { total, errors } = repo.rebuildIndex();
    expect(total).toBe(1);
    expect(errors).toBe(1);
    expect(repo.get('project.bad.invalid')).toBeNull();
  });

  it('atomic write does not leave partial files on validation failure', () => {
    const input = {
      ...makeInput(),
      confidence: 2.0, // invalid: > 1.0
    };
    expect(() => repo.create(input)).toThrow();
    // No file should exist
    const listed = repo.list();
    expect(listed.length).toBe(0);
  });
});
