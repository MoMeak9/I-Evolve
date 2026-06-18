import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteIndex } from './sqlite-index.js';

const dir = join('/tmp', `ie-vec-${randomBytes(4).toString('hex')}`);
let idx: SqliteIndex;

beforeEach(() => {
  mkdirSync(dir, { recursive: true });
  idx = new SqliteIndex(join(dir, 'index.db'));
});
afterEach(() => {
  idx.close();
  rmSync(dir, { recursive: true, force: true });
});

function vec(...xs: number[]): Float32Array {
  return new Float32Array(xs);
}

describe('SqliteIndex vectors', () => {
  it('upserts and queries nearest by cosine (normalized = dot)', () => {
    idx.upsertVectors([
      { chunkId: 'c1', memoryId: 'm1', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h1', vector: vec(1, 0), indexedAt: '2026-06-18T00:00:00.000Z' },
      { chunkId: 'c2', memoryId: 'm2', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h2', vector: vec(0, 1), indexedAt: '2026-06-18T00:00:00.000Z' },
    ]);
    const hits = idx.queryNearest(vec(1, 0), 'lite', 2);
    expect(hits[0].memory_id).toBe('m1');
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect(hits[1].memory_id).toBe('m2');
    expect(hits[1].score).toBeCloseTo(0, 5);
  });

  it('isolates vectors by model_id', () => {
    idx.upsertVectors([
      { chunkId: 'c1', memoryId: 'm1', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h1', vector: vec(1, 0), indexedAt: '2026-06-18T00:00:00.000Z' },
    ]);
    expect(idx.queryNearest(vec(1, 0), 'other-model', 5)).toHaveLength(0);
  });

  it('prunes stale chunks for a memory, keeping listed ones', () => {
    idx.upsertVectors([
      { chunkId: 'c1', memoryId: 'm1', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h1', vector: vec(1, 0), indexedAt: '2026-06-18T00:00:00.000Z' },
      { chunkId: 'c2', memoryId: 'm1', chunkType: 'header', modelId: 'lite', dimension: 2, contentHash: 'h2', vector: vec(0, 1), indexedAt: '2026-06-18T00:00:00.000Z' },
    ]);
    idx.pruneVectors('m1', ['c1']);
    const hits = idx.queryNearest(vec(0, 1), 'lite', 5);
    expect(hits.map((h) => h.chunk_id)).toEqual(['c1']);
  });

  it('reports vector stats by model', () => {
    idx.upsertVectors([
      { chunkId: 'c1', memoryId: 'm1', chunkType: 'semantic', modelId: 'lite', dimension: 2, contentHash: 'h1', vector: vec(1, 0), indexedAt: '2026-06-18T00:00:00.000Z' },
    ]);
    expect(idx.vectorStats('lite').vectors).toBe(1);
  });
});
