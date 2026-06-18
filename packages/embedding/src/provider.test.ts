import { describe, expect, it } from 'vitest';
import { l2Normalize, meanPool, PROFILES, resolveProfile } from './provider.js';

describe('embedding vector utils', () => {
  it('l2-normalizes a vector to unit length', () => {
    const out = l2Normalize(new Float32Array([3, 4]));
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 5);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
  });

  it('mean-pools a [tokens x dim] matrix over tokens', () => {
    // 2 tokens, dim 2: [[1,2],[3,4]] -> [2,3]
    const pooled = meanPool(new Float32Array([1, 2, 3, 4]), 2, 2);
    expect(Array.from(pooled)).toEqual([2, 3]);
  });

  it('maps the lite profile to multilingual-e5-small with dim 384', () => {
    expect(resolveProfile('lite').modelId).toBe('intfloat/multilingual-e5-small');
    expect(resolveProfile('lite').dimension).toBe(384);
  });

  it('defaults unknown profile names to lite', () => {
    expect(resolveProfile(undefined).profile).toBe('lite');
    expect(PROFILES.default.modelId).toBe('BAAI/bge-m3');
  });
});
