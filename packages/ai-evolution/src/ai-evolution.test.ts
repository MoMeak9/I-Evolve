import { describe, it, expect } from 'vitest';
import { MockAiProvider } from './provider/mock-provider.js';
import { SessionSummarizer } from './extractor/SessionSummarizer.js';
import { MemoryCandidateExtractor } from './extractor/MemoryCandidateExtractor.js';
import { PolicyJudge } from './judge/PolicyJudge.js';
import { EvolutionPipeline } from './pipeline.js';
import { containsSecret, redact } from './redaction.js';
import type { Observation, SessionSummary, CandidateMemory, AuditAction } from '@i-evolve/core';

const NOW = '2026-06-12T10:00:00.000Z';

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

function makeSummary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-summary.sess-1',
    sessionId: 'sess-1',
    repoId: 'bilibili/column-web',
    projectId: 'bilibili-column',
    endedAt: NOW,
    summary: 'Worked on memory module.',
    decisions: [],
    constraints: [],
    mistakes: [],
    userCorrections: [],
    filesTouched: ['packages/core/src/memory.ts'],
    candidateMemoryHints: [],
    candidateInstinctHints: [],
    sensitivity: 'internal',
    expiresAt: '2026-07-12T10:00:00.000Z',
    ...over,
  };
}

describe('SessionSummarizer', () => {
  it('generates a summary from observations', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify({
      summary: 'Edited the memory module.',
      decisions: ['Use atomic writes'],
      filesTouched: ['packages/core/src/memory.ts'],
      candidateMemoryHints: ['memory module uses atomic writes'],
    }));

    const summarizer = new SessionSummarizer(provider);
    const summary = await summarizer.summarize({
      sessionId: 'sess-1',
      repoId: 'bilibili/column-web',
      observations: [makeObservation()],
      endedAt: NOW,
    });

    expect(summary.sessionId).toBe('sess-1');
    expect(summary.summary).toContain('memory module');
    expect(summary.expiresAt).toBeDefined();
    expect(summary.sensitivity).toBe('internal');
  });

  it('marks sensitivity as sensitive when any observation is sensitive', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify({ summary: 'x' }));
    const summarizer = new SessionSummarizer(provider);
    const summary = await summarizer.summarize({
      sessionId: 'sess-2',
      observations: [makeObservation({ sensitivity: 'sensitive' })],
      endedAt: NOW,
    });
    expect(summary.sensitivity).toBe('sensitive');
  });
});

describe('MemoryCandidateExtractor', () => {
  it('extracts candidate memories', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify([{
      title: 'Old editor return button',
      type: 'project_fact',
      proposedScope: 'project',
      content: 'Old editor content needs a return button.',
      evidence: ['session'],
      sourceRefs: ['session-summary.sess-1'],
      confidence: 0.91,
      riskFlags: [],
    }]));

    const extractor = new MemoryCandidateExtractor(provider);
    const candidates = await extractor.extract(makeSummary());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('project_fact');
    expect(candidates[0].projectId).toBe('bilibili-column');
  });

  it('flags candidates containing secrets', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify([{
      title: 'Bad memory',
      type: 'project_fact',
      proposedScope: 'project',
      content: 'api_key = "abcdef1234567890"',
      confidence: 0.95,
      riskFlags: [],
    }]));
    const extractor = new MemoryCandidateExtractor(provider);
    const candidates = await extractor.extract(makeSummary());
    expect(candidates[0].riskFlags).toContain('secret');
  });
});

function makeCandidate(over: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    title: 'Old editor return button',
    type: 'project_fact',
    proposedScope: 'project',
    content: 'Old editor content needs a return button.',
    evidence: ['session'],
    sourceRefs: ['session-summary.sess-1'],
    confidence: 0.91,
    riskFlags: [],
    projectId: 'bilibili-column',
    repoId: 'bilibili/column-web',
    ...over,
  };
}

describe('PolicyJudge', () => {
  const judge = new PolicyJudge();

  it('activates high-confidence project_fact', () => {
    const decision = judge.judge(makeCandidate(), {}, NOW);
    expect(decision.decision).toBe('activate');
    expect(decision.finalScope).toBe('project');
    expect(decision.ttlDays).toBe(365);
  });

  it('rejects low-confidence memory', () => {
    const decision = judge.judge(makeCandidate({ confidence: 0.4 }), {}, NOW);
    expect(decision.decision).toBe('reject');
  });

  it('asks for more evidence at borderline confidence', () => {
    const decision = judge.judge(makeCandidate({ confidence: 0.6 }), {}, NOW);
    expect(decision.decision).toBe('needs_more_evidence');
  });

  it('does not promote task_constraint to global', () => {
    const decision = judge.judge(
      makeCandidate({ type: 'task_constraint', proposedScope: 'global', confidence: 0.95 }),
      {}, NOW,
    );
    expect(decision.decision).toBe('downgrade_scope');
    expect(decision.finalScope).toBe('task');
    expect(decision.ttlDays).toBeLessThanOrEqual(30);
  });

  it('rejects candidates with secrets', () => {
    const decision = judge.judge(
      makeCandidate({ content: 'token = "ghp_abcdefghijklmnop1234"', confidence: 0.95 }),
      {}, NOW,
    );
    expect(decision.decision).toBe('reject');
    expect(decision.policyChecks.find(c => c.policy === 'secret_detection')?.passed).toBe(false);
  });

  it('rejects candidates similar to tombstones', () => {
    const decision = judge.judge(makeCandidate(), { tombstoneTitles: ['Old editor return button'] }, NOW);
    expect(decision.decision).toBe('reject');
  });

  it('downgrades global to domain when confidence below 0.9', () => {
    const decision = judge.judge(
      makeCandidate({ type: 'workflow_rule', proposedScope: 'global', domain: 'web', confidence: 0.85 }),
      {}, NOW,
    );
    expect(decision.decision).toBe('downgrade_scope');
    expect(decision.finalScope).toBe('domain');
  });
});

describe('EvolutionPipeline', () => {
  it('writes memory and audit on activate', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify([{
      title: 'Old editor return button',
      type: 'project_fact',
      proposedScope: 'project',
      content: 'Old editor needs a return button.',
      confidence: 0.91,
      sourceRefs: ['session-summary.sess-1'],
      riskFlags: [],
    }]));

    const written: unknown[] = [];
    const audits: AuditAction[] = [];
    const pipeline = new EvolutionPipeline({
      provider,
      writeMemory: (input) => { written.push(input); return { ...input } as any; },
      appendAudit: (a) => { audits.push(a); },
      now: () => NOW,
    });

    const summary = makeSummary();
    const results = await pipeline.run(summary);
    expect(results).toHaveLength(1);
    expect(results[0].written).toBe(true);
    expect(written).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('ai_approve');
  });

  it('dry-run does not write files or audit', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify([{
      title: 'Some fact',
      type: 'project_fact',
      proposedScope: 'project',
      content: 'A fact.',
      confidence: 0.91,
      riskFlags: [],
    }]));

    const written: unknown[] = [];
    const audits: AuditAction[] = [];
    const pipeline = new EvolutionPipeline({
      provider,
      writeMemory: (input) => { written.push(input); return { ...input } as any; },
      appendAudit: (a) => { audits.push(a); },
      now: () => NOW,
    });

    const results = await pipeline.run(makeSummary(), { dryRun: true });
    expect(results[0].written).toBe(false);
    expect(written).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('rejects and audits a low-confidence candidate without writing', async () => {
    const provider = new MockAiProvider();
    provider.setDefault(JSON.stringify([{
      title: 'Weak fact',
      type: 'project_fact',
      proposedScope: 'project',
      content: 'Maybe true.',
      confidence: 0.3,
      riskFlags: [],
    }]));

    const written: unknown[] = [];
    const audits: AuditAction[] = [];
    const pipeline = new EvolutionPipeline({
      provider,
      writeMemory: (input) => { written.push(input); return { ...input } as any; },
      appendAudit: (a) => { audits.push(a); },
      now: () => NOW,
    });

    const results = await pipeline.run(makeSummary());
    expect(results[0].written).toBe(false);
    expect(written).toHaveLength(0);
    expect(audits[0].action).toBe('ai_reject');
  });
});

describe('redaction', () => {
  it('detects and redacts secrets', () => {
    const r = redact('my token = "ghp_abcdefghijklmnop1234"');
    expect(r.secretsFound.length).toBeGreaterThan(0);
    expect(r.text).toContain('[REDACTED');
  });

  it('detects secrets via containsSecret', () => {
    expect(containsSecret('AKIAABCDEFGHIJKLMNOP')).toBe(true);
    expect(containsSecret('just plain text')).toBe(false);
  });
});
