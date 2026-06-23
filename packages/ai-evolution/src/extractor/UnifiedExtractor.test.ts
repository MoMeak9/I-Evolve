import { describe, it, expect } from 'vitest';
import { UnifiedExtractor } from './UnifiedExtractor.js';
import type { Observation } from '@i-evolve/core';

const NOW = '2026-06-23T10:00:00.000Z';

function makeObservation(over: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1',
    timestamp: NOW,
    sessionId: 'sess-1',
    source: 'claude-code',
    phase: 'post_tool_use',
    tool: 'Edit',
    summary: 'Edited packages/core/src/memory.ts',
    filesTouched: ['packages/core/src/memory.ts'],
    status: 'success',
    sensitivity: 'internal',
    ...over,
  };
}

const VALID_RESPONSE = JSON.stringify({
  summary: {
    summary: 'Worked on the memory module to add atomic writes.',
    decisions: ['Use atomic writes'],
    constraints: [],
    mistakes: [],
    userCorrections: [],
    filesTouched: ['packages/core/src/memory.ts'],
    candidateMemoryHints: ['memory module uses atomic writes'],
    candidateInstinctHints: [],
  },
  candidates: [
    {
      title: 'Memory module uses atomic writes',
      type: 'repo_fact',
      proposedScope: 'repo',
      content: 'The memory module uses atomic writes for safe concurrent access.',
      evidence: ['obs-1'],
      sourceRefs: ['session-summary.sess-1'],
      confidence: 0.91,
      riskFlags: [],
    },
  ],
});

describe('UnifiedExtractor', () => {
  it('parses valid LLM response into summary and candidates', async () => {
    const provider = { complete: async () => ({ text: VALID_RESPONSE }) };
    const extractor = new UnifiedExtractor(provider);

    const result = await extractor.extract([makeObservation()], 'sess-1', 'bilibili/column-web');

    expect(result.summary.sessionId).toBe('sess-1');
    expect(result.summary.repoId).toBe('bilibili/column-web');
    expect(result.summary.summary).toContain('atomic writes');
    expect(result.summary.decisions).toEqual(['Use atomic writes']);
    expect(result.summary.id).toBe('session-summary.sess-1');
    expect(result.summary.expiresAt).toBeDefined();

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].type).toBe('repo_fact');
    expect(result.candidates[0].confidence).toBe(0.91);
    expect(result.candidates[0].repoId).toBe('bilibili/column-web');
  });

  it('returns empty candidates when LLM returns none', async () => {
    const response = JSON.stringify({
      summary: {
        summary: 'Nothing notable happened.',
        decisions: [],
        constraints: [],
        mistakes: [],
        userCorrections: [],
        filesTouched: [],
        candidateMemoryHints: [],
        candidateInstinctHints: [],
      },
      candidates: [],
    });
    const provider = { complete: async () => ({ text: response }) };
    const extractor = new UnifiedExtractor(provider);

    const result = await extractor.extract([makeObservation()], 'sess-2');

    expect(result.candidates).toHaveLength(0);
    expect(result.summary.summary).toBe('Nothing notable happened.');
  });

  it('filters out candidates below confidence 0.7', async () => {
    const response = JSON.stringify({
      summary: {
        summary: 'Some work done.',
        decisions: [],
        constraints: [],
        mistakes: [],
        userCorrections: [],
        filesTouched: [],
        candidateMemoryHints: [],
        candidateInstinctHints: [],
      },
      candidates: [
        {
          title: 'High confidence fact',
          type: 'repo_fact',
          proposedScope: 'repo',
          content: 'This is reliable.',
          evidence: [],
          sourceRefs: [],
          confidence: 0.85,
          riskFlags: [],
        },
        {
          title: 'Low confidence guess',
          type: 'repo_fact',
          proposedScope: 'repo',
          content: 'This might be true.',
          evidence: [],
          sourceRefs: [],
          confidence: 0.5,
          riskFlags: [],
        },
        {
          title: 'Border case exactly 0.7',
          type: 'workflow_rule',
          proposedScope: 'repo',
          content: 'Do this thing.',
          evidence: [],
          sourceRefs: [],
          confidence: 0.7,
          riskFlags: [],
        },
      ],
    });
    const provider = { complete: async () => ({ text: response }) };
    const extractor = new UnifiedExtractor(provider);

    const result = await extractor.extract([makeObservation()], 'sess-3');

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.title)).toEqual([
      'High confidence fact',
      'Border case exactly 0.7',
    ]);
  });
});
