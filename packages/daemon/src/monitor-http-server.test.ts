import { describe, it, expect, afterEach } from 'vitest';
import { EventBus } from './event-bus.js';
import { MonitorHttpServer } from './monitor-http-server.js';
import { MONITOR_EVENT } from './monitor-types.js';
import type { MonitorSnapshot } from './monitor-types.js';

const PORT = 17399; // 测试端口,避开默认 17361

describe('MonitorHttpServer', () => {
  let server: MonitorHttpServer;
  afterEach(async () => { await server?.stop(); });

  it('GET /snapshot 返回 events 与 stats', async () => {
    const bus = new EventBus();
    bus.emit({ stage: 'observe', type: MONITOR_EVENT.observationReceived, summary: 'x' });
    server = new MonitorHttpServer(bus, { port: PORT, staticDir: null });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT}/snapshot`);
    const body = (await res.json()) as MonitorSnapshot;
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.events).toHaveLength(1);
    expect(body.stats.observations).toBe(1);
  });

  it('GET /events 返回 text/event-stream 且能收到后续 emit', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, { port: PORT, staticDir: null });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    bus.emit({ stage: 'observe', type: MONITOR_EVENT.observationReceived, summary: 'live' });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
    expect(text).toContain('live');
    await reader.cancel();
  });

  it('端口被占用时 start() 返回 false 而不抛错', async () => {
    const bus = new EventBus();
    const first = new MonitorHttpServer(bus, { port: PORT, staticDir: null });
    await first.start();
    const second = new MonitorHttpServer(bus, { port: PORT, staticDir: null });
    const ok = await second.start();
    expect(ok).toBe(false);
    await first.stop();
  });

  it('GET /memories 返回记忆库真实总数与轻量列表', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, {
      port: PORT + 1,
      staticDir: null,
      memoryList: () => ({ total: 2, items: [{ id: 'a' }, { id: 'b' }] }),
    });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT + 1}/memories`);
    const body = (await res.json()) as { total: number; items: unknown[] };
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it('GET /memory?id= 返回单条记忆详情', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, {
      port: PORT + 2,
      staticDir: null,
      memoryDetail: (id) => (id === 'x' ? { id: 'x', content: 'hello' } : null),
    });
    await server.start();
    const hit = await (await fetch(`http://127.0.0.1:${PORT + 2}/memory?id=x`)).json();
    expect(hit).toEqual({ id: 'x', content: 'hello' });
    const miss = await (await fetch(`http://127.0.0.1:${PORT + 2}/memory?id=nope`)).json();
    expect(miss).toBeNull();
  });

  it('未提供 memoryList 时 /memories 返回空而非报错', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, { port: PORT + 3, staticDir: null });
    await server.start();
    const body = (await (await fetch(`http://127.0.0.1:${PORT + 3}/memories`)).json()) as { total: number };
    expect(body.total).toBe(0);
  });
});
