import { describe, expect, it } from 'vitest';
import { chunkMemory, inferPromptIntent } from './retrieval-runtime.js';
import type { MemoryItem } from '@i-evolve/core';

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'workflow.ssr.hydration-check',
    type: 'workflow_rule',
    scope: 'project',
    projectId: 'web',
    domain: 'ssr',
    title: 'SSR hydration review checklist',
    content: 'Check client/server rendering differences before approving SSR migrations.',
    status: 'active',
    visibility: 'team',
    confidence: 0.92,
    sourceRefs: [],
    tags: ['ssr', 'hydration'],
    revision: 3,
    contentHash: 'abc123',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('retrieval runtime', () => {
  it('infers code review intent for SSR hydration prompts', () => {
    const intent = inferPromptIntent('帮我 review SSR 迁移后的水合问题');
    expect(intent.task_type).toBe('code_review');
    expect(intent.domain).toBe('ssr');
    expect(intent.action_level).toBe('read_only');
    expect(intent.expected_output).toBe('audit_report');
    expect(intent.risk_flags).toContain('hydration');
    expect(intent.memory_needs.need_pitfall).toBe(true);
  });

  it('creates stable memory-aware chunks for header, semantic, and operational retrieval', () => {
    const first = chunkMemory(memory(), '2026-06-18T00:00:00.000Z');
    const second = chunkMemory(memory(), '2026-06-18T00:00:00.000Z');
    expect(first.map((chunk) => chunk.chunk_type)).toEqual(['header', 'semantic', 'operational']);
    expect(first.map((chunk) => chunk.chunk_id)).toEqual(second.map((chunk) => chunk.chunk_id));
    expect(first[0].metadata.project_id).toBe('web');
    expect(first[0].index.embedding_model).toBe('BAAI/bge-m3');
  });
});
