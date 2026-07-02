import { EventEmitter } from 'node:events';
import type { MonitorEvent, MonitorStats, MonitorSnapshot } from './monitor-types.js';
import { MONITOR_EVENT } from './monitor-types.js';

const DEFAULT_BUFFER = 200;

export interface EventBusOptions {
  bufferSize?: number;
}

type EmitInput = Omit<MonitorEvent, 'id' | 'ts'>;

export class EventBus {
  private emitter = new EventEmitter();
  private buffer: MonitorEvent[] = [];
  private seq = 0;
  private bufferSize: number;
  private stats: MonitorStats = {
    observations: 0, candidates: 0, accepted: 0, rejected: 0, memories: 0, wasted: 0,
  };

  constructor(opts: EventBusOptions = {}) {
    this.bufferSize = opts.bufferSize ?? DEFAULT_BUFFER;
    this.emitter.setMaxListeners(0); // SSE 连接数不设上限告警
  }

  emit(input: EmitInput): void {
    try {
      const event: MonitorEvent = { ...input, id: ++this.seq, ts: new Date().toISOString() };
      this.updateStats(event);
      this.buffer.push(event);
      if (this.buffer.length > this.bufferSize) this.buffer.shift();
      // 逐订阅者独立 try-catch:单个抛错不影响其他、不冒泡
      for (const listener of this.emitter.listeners('event')) {
        try { (listener as (e: MonitorEvent) => void)(event); } catch { /* 旁路:吞掉 */ }
      }
    } catch { /* 埋点绝不冒泡到流水线 */ }
  }

  subscribe(fn: (e: MonitorEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  snapshot(): MonitorSnapshot {
    return { events: [...this.buffer], stats: { ...this.stats } };
  }

  eventsSince(lastId: number): MonitorEvent[] {
    return this.buffer.filter((e) => e.id > lastId);
  }

  private updateStats(e: MonitorEvent): void {
    switch (e.type) {
      case MONITOR_EVENT.observationReceived: this.stats.observations++; break;
      case MONITOR_EVENT.extractCandidate: this.stats.candidates++; break;
      case MONITOR_EVENT.memoryCreated:
      case MONITOR_EVENT.candidatePromoted: this.stats.memories++; break;
      case MONITOR_EVENT.judgeResult:
        if (e.detail?.decision === 'reject') { this.stats.rejected++; this.stats.wasted++; }
        else this.stats.accepted++;
        break;
    }
  }
}
