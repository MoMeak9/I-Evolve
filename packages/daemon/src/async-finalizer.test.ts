import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncFinalizer, type AsyncFinalizerDeps } from './async-finalizer.js';
import type { Observation, CandidateMemory, SessionSummary } from '@i-evolve/core';

// Minimal observation for tests
const obs: Observation = {
  id: 'obs-1',
  timestamp: '2026-06-23T00:00:00.000Z',
  sessionId: 'sess-1',
  source: 'cli',
  phase: 'manual',
  summary: 'test observation',
  status: 'success',
  sensitivity: 'internal',
};

const summary: SessionSummary = {
  id: 'session-summary.sess-1',
  sessionId: 'sess-1',
  endedAt: '2026-06-23T00:00:00.000Z',
  summary: 'did stuff',
  decisions: [],
  constraints: [],
  mistakes: [],
  userCorrections: [],
  filesTouched: [],
  candidateMemoryHints: [],
  candidateInstinctHints: [],
  sensitivity: 'internal',
  expiresAt: '2026-07-23T00:00:00.000Z',
};

const candidate: CandidateMemory = {
  title: 'Use SSR for dashboard',
  type: 'repo_fact',
  proposedScope: 'repo',
  content: 'Always use SSR for dashboard routes.',
  evidence: ['session-summary.sess-1'],
  sourceRefs: ['session-summary.sess-1'],
  confidence: 0.85,
  riskFlags: [],
  repoId: 'acme/demo',
};

function makeActivateDecision() {
  return {
    decision: 'activate' as const,
    finalScope: 'repo' as const,
    finalType: 'repo_fact' as const,
    confidence: 0.85,
    ttlDays: 90,
    expiresAt: '2026-09-23T00:00:00.000Z',
    reason: 'Meets confidence and scope policies',
    policyChecks: [{ policy: 'schema_validation', passed: true }],
  };
}

function makeDeps(overrides: Partial<AsyncFinalizerDeps> = {}): AsyncFinalizerDeps {
  return {
    extract: vi.fn().mockResolvedValue({ summary, candidates: [candidate] }),
    saveSession: vi.fn(),
    countCandidatesBySlug: vi.fn().mockReturnValue(0),
    createMemory: vi.fn().mockReturnValue({}),
    promoteCandidatesBySlug: vi.fn().mockReturnValue({}),
    appendAudit: vi.fn(),
    judgeCandidate: vi.fn().mockReturnValue(makeActivateDecision()),
    logWarning: vi.fn(),
    ...overrides,
  };
}

describe('AsyncFinalizer', () => {
  it('runs extraction, saves summary, and writes candidates', async () => {
    const deps = makeDeps();
    const finalizer = new AsyncFinalizer(deps);

    await finalizer.finalize([obs], 'sess-1', 'acme/demo');

    expect(deps.extract).toHaveBeenCalledOnce();
    expect(deps.extract).toHaveBeenCalledWith([obs], 'sess-1', 'acme/demo');
    expect(deps.saveSession).toHaveBeenCalledWith(summary);
    expect(deps.judgeCandidate).toHaveBeenCalledWith(candidate);
    // count < 2, so createMemory is called with status 'candidate'
    expect(deps.countCandidatesBySlug).toHaveBeenCalledWith('use-ssr-for-dashboard');
    expect(deps.createMemory).toHaveBeenCalledOnce();
    expect(deps.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'candidate', content: candidate.content }),
    );
    expect(deps.promoteCandidatesBySlug).not.toHaveBeenCalled();
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it('promotes to active when slug count >= 2 (becoming 3rd occurrence)', async () => {
    const deps = makeDeps({
      countCandidatesBySlug: vi.fn().mockReturnValue(2),
    });
    const finalizer = new AsyncFinalizer(deps);

    await finalizer.finalize([obs], 'sess-1', 'acme/demo');

    expect(deps.promoteCandidatesBySlug).toHaveBeenCalledOnce();
    expect(deps.promoteCandidatesBySlug).toHaveBeenCalledWith(
      'use-ssr-for-dashboard',
      candidate.content,
      expect.stringContaining('use-ssr-for-dashboard'),
    );
    expect(deps.createMemory).not.toHaveBeenCalled();
  });

  it('calls onPromoted callback after promotion', async () => {
    const onPromoted = vi.fn();
    const deps = makeDeps({
      countCandidatesBySlug: vi.fn().mockReturnValue(2),
      onPromoted,
    });
    const finalizer = new AsyncFinalizer(deps);

    await finalizer.finalize([obs], 'sess-1', 'acme/demo');

    expect(onPromoted).toHaveBeenCalledOnce();
    expect(onPromoted).toHaveBeenCalledWith({
      id: expect.stringContaining('use-ssr-for-dashboard'),
      visibility: 'team',
    });
  });

  it('retries on failure up to 2 times', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const extractFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) return Promise.reject(new Error(`Attempt ${callCount} failed`));
      return Promise.resolve({ summary, candidates: [candidate] });
    });

    const deps = makeDeps({ extract: extractFn });
    const finalizer = new AsyncFinalizer(deps);

    const promise = finalizer.finalize([obs], 'sess-1');

    // advance past first retry delay (2000ms)
    await vi.advanceTimersByTimeAsync(2000);
    // advance past second retry delay (4000ms)
    await vi.advanceTimersByTimeAsync(4000);

    await promise;

    expect(extractFn).toHaveBeenCalledTimes(3);
    expect(deps.logWarning).not.toHaveBeenCalled();
    expect(deps.saveSession).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it('gives up after 3 total attempts and logs warning', async () => {
    vi.useFakeTimers();

    const extractFn = vi.fn().mockRejectedValue(new Error('always fails'));
    const deps = makeDeps({ extract: extractFn });
    const finalizer = new AsyncFinalizer(deps);

    const promise = finalizer.finalize([obs], 'sess-1');

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    await promise;

    expect(extractFn).toHaveBeenCalledTimes(3);
    expect(deps.logWarning).toHaveBeenCalledOnce();
    expect(deps.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('failed after 3 attempts'),
    );
    expect(deps.saveSession).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
