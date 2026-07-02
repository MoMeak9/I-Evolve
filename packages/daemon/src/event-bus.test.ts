import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus.js';
import { MONITOR_EVENT } from './monitor-types.js';

function sampleInput(overrides = {}) {
  return {
    stage: 'observe' as const,
    type: MONITOR_EVENT.observationReceived,
    summary: 'obs received',
    ...overrides,
  };
}

describe('EventBus', () => {
  it('emit 后订阅者收到事件,并补上 id 与 ts', () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe((e) => received.push(e));
    bus.emit(sampleInput());
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(1);
    expect(typeof received[0].ts).toBe('string');
    expect(received[0].type).toBe('observation.received');
  });

  it('id 单调递增', () => {
    const bus = new EventBus();
    bus.emit(sampleInput());
    bus.emit(sampleInput());
    const snap = bus.snapshot();
    expect(snap.events.map((e) => e.id)).toEqual([1, 2]);
  });

  it('环形缓冲超上限丢最旧', () => {
    const bus = new EventBus({ bufferSize: 3 });
    for (let i = 0; i < 5; i++) bus.emit(sampleInput());
    const snap = bus.snapshot();
    expect(snap.events).toHaveLength(3);
    expect(snap.events.map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it('eventsSince 只返回 id 大于 lastId 的缓冲事件', () => {
    const bus = new EventBus();
    bus.emit(sampleInput());
    bus.emit(sampleInput());
    bus.emit(sampleInput());
    expect(bus.eventsSince(1).map((e) => e.id)).toEqual([2, 3]);
  });

  it('subscribe 返回的退订函数生效', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const unsub = bus.subscribe(fn);
    bus.emit(sampleInput());
    unsub();
    bus.emit(sampleInput());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('单个订阅者抛错被吞,不影响其他订阅者、不冒泡', () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe(good);
    expect(() => bus.emit(sampleInput())).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stats 随 emit 累计', () => {
    const bus = new EventBus();
    bus.emit(sampleInput({ type: MONITOR_EVENT.observationReceived }));
    bus.emit(sampleInput({ stage: 'think', type: MONITOR_EVENT.extractCandidate }));
    bus.emit(sampleInput({ stage: 'store', type: MONITOR_EVENT.candidatePromoted }));
    bus.emit(sampleInput({ stage: 'judge', type: MONITOR_EVENT.judgeResult, detail: { decision: 'reject' } }));
    const { stats } = bus.snapshot();
    expect(stats.observations).toBe(1);
    expect(stats.candidates).toBe(1);
    expect(stats.memories).toBe(1);
    expect(stats.rejected).toBe(1);
  });
});
