import { describe, it, expect } from 'vitest';
import { EventBus } from './event-bus.js';
import { instrumentFinalizerDeps } from './pipeline-events.js';
import type { AsyncFinalizerDeps } from './async-finalizer.js';

function baseDeps(): AsyncFinalizerDeps {
  return {
    extract: async () => ({ summary: { sessionId: 's', highlights: [] } as any, candidates: [
      { title: 'Prefer pnpm', content: 'use pnpm', type: 'preference', proposedScope: 'project', confidence: 0.8, sourceRefs: [] } as any,
    ] }),
    saveSession: () => {},
    countCandidatesBySlug: () => 0,
    createMemory: () => ({}),
    promoteCandidatesBySlug: () => ({}),
    appendAudit: () => {},
    judgeCandidate: () => ({ decision: 'activate', confidence: 0.8, reason: 'ok', policyChecks: [] }),
  };
}

describe('instrumentFinalizerDeps', () => {
  it('extract 包装后 emit extract.start(带条数)且原返回值不变', async () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const deps = instrumentFinalizerDeps(baseDeps(), bus, 'sess-1');
    const obs = [{ id: 'o1' }, { id: 'o2' }] as any;
    const result = await deps.extract(obs, 'sess-1');
    expect(result.candidates).toHaveLength(1);
    const start = events.find((e) => e.type === 'extract.start');
    expect(start).toBeTruthy();
    expect(start.detail.observationCount).toBe(2);
    expect(start.sessionId).toBe('sess-1');
    expect(events.filter((e) => e.type === 'extract.candidate')).toHaveLength(1);
    const cand = events.find((e) => e.type === 'extract.candidate');
    expect(cand.detail.slug).toBeTruthy();
    expect(cand.detail.slug).toBe('prefer-pnpm');
  });

  it('judgeCandidate 包装后 emit judge.start 与 judge.result(带 decision + reason)', () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const deps = instrumentFinalizerDeps(baseDeps(), bus, 'sess-1');
    const decision = deps.judgeCandidate({ title: 'X', confidence: 0.8 } as any);
    expect(decision.decision).toBe('activate');
    expect(events.find((e) => e.type === 'judge.start')).toBeTruthy();
    const result = events.find((e) => e.type === 'judge.result');
    expect(result.detail.decision).toBe('activate');
    expect(result.detail.reason).toBe('ok');
  });

  it('reject 决策的 judge.result 携带 reason', () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const base = baseDeps();
    base.judgeCandidate = () => ({ decision: 'reject', confidence: 0.2, reason: 'duplicate', policyChecks: [] });
    const deps = instrumentFinalizerDeps(base, bus, 'sess-1');
    deps.judgeCandidate({ title: 'X', confidence: 0.2 } as any);
    const result = events.find((e) => e.type === 'judge.result');
    expect(result.detail.decision).toBe('reject');
    expect(result.detail.reason).toBe('duplicate');
  });

  it('createMemory 包装后 emit memory.created', () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const deps = instrumentFinalizerDeps(baseDeps(), bus, 'sess-1');
    deps.createMemory({ id: 'project.x.prefer-pnpm', title: 'Prefer pnpm', status: 'candidate' });
    expect(events.find((e) => e.type === 'memory.created')).toBeTruthy();
  });

  it('promoteCandidatesBySlug 包装后 emit candidate.promoted', () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const deps = instrumentFinalizerDeps(baseDeps(), bus, 'sess-1');
    deps.promoteCandidatesBySlug('prefer-pnpm', 'use pnpm', 'project.x.prefer-pnpm');
    expect(events.find((e) => e.type === 'candidate.promoted')).toBeTruthy();
  });

  it('base 无 onPromoted 时,包装结果的 onPromoted 保持 undefined', () => {
    const bus = new EventBus();
    const deps = instrumentFinalizerDeps(baseDeps(), bus, 'sess-1');
    expect(deps.onPromoted).toBeUndefined();
  });
});
