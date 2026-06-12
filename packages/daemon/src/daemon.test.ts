import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setBasePath, paths } from './paths.js';
import { Daemon } from './daemon.js';
import { sendRequest } from './ipc-client.js';
import { ObservationWriter } from './observation-writer.js';
import { AuditWriter } from './audit-writer.js';

// Use /tmp with short ID to stay under macOS 104-byte socket path limit
const testDir = join('/tmp', `ie-${randomBytes(4).toString('hex')}`);

beforeEach(() => {
  setBasePath(testDir);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Daemon lifecycle', () => {
  let daemon: Daemon;

  beforeEach(() => {
    daemon = new Daemon();
  });

  afterEach(async () => {
    try { await daemon.stop(); } catch {}
  });

  it('starts and responds to ping', async () => {
    await daemon.start();
    const resp = await sendRequest({ type: 'ping' });
    expect(resp.ok).toBe(true);
    expect((resp.data as any).pong).toBe(true);
  });

  it('responds to health', async () => {
    await daemon.start();
    const resp = await sendRequest({ type: 'health' });
    expect(resp.ok).toBe(true);
    expect((resp.data as any).status).toBe('running');
    expect((resp.data as any).pid).toBe(process.pid);
  });

  it('rejects duplicate start via process lock', async () => {
    await daemon.start();
    const daemon2 = new Daemon();
    await expect(daemon2.start()).rejects.toThrow(/already running/);
  });

  it('stops cleanly', async () => {
    await daemon.start();
    await daemon.stop();
    expect(existsSync(paths.runtime.lock)).toBe(false);
    expect(existsSync(paths.runtime.pid)).toBe(false);
  });
});

describe('ObservationWriter', () => {
  it('appends valid observation to JSONL', () => {
    const writer = new ObservationWriter();
    writer.append({
      id: 'obs-001',
      timestamp: '2026-06-12T10:00:00+08:00',
      sessionId: 'sess-001',
      source: 'cli',
      phase: 'manual',
      summary: 'test observation',
      status: 'success',
      sensitivity: 'internal',
    });
    const content = readFileSync(paths.observations.current, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.id).toBe('obs-001');
    expect(parsed.received_at).toBeDefined();
  });

  it('rejects invalid observation', () => {
    const writer = new ObservationWriter();
    expect(() => writer.append({ id: 'x' } as any)).toThrow();
  });
});

describe('AuditWriter', () => {
  it('appends valid audit action to JSONL', () => {
    const writer = new AuditWriter();
    writer.append({
      id: 'audit-001',
      memoryId: 'mem-001',
      action: 'propose',
      actorType: 'user',
      actorId: 'user-1',
      reason: 'test',
      confidence: 0.9,
      sourceRefs: ['ref-1'],
      policyChecks: [{ policy: 'scope', passed: true }],
      createdAt: '2026-06-12T10:00:00+08:00',
    });
    const content = readFileSync(paths.audit.current, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.id).toBe('audit-001');
  });

  it('rejects invalid audit action', () => {
    const writer = new AuditWriter();
    expect(() => writer.append({ id: 'x' } as any)).toThrow();
  });
});

describe('Daemon IPC observe', () => {
  let daemon: Daemon;

  beforeEach(async () => {
    daemon = new Daemon();
    await daemon.start();
  });

  afterEach(async () => {
    try { await daemon.stop(); } catch {}
  });

  it('appends observation via IPC', async () => {
    const resp = await sendRequest({
      type: 'observe',
      payload: {
        id: 'obs-ipc-001',
        timestamp: '2026-06-12T10:00:00+08:00',
        sessionId: 'sess-ipc',
        source: 'cli',
        phase: 'manual',
        summary: 'test via ipc',
        status: 'success',
        sensitivity: 'internal',
      } as any,
    });
    expect(resp.ok).toBe(true);
    const content = readFileSync(paths.observations.current, 'utf-8');
    expect(content).toContain('obs-ipc-001');
  });

  it('rejects malformed observation via IPC', async () => {
    const resp = await sendRequest({
      type: 'observe',
      payload: { id: 'bad' } as any,
    });
    expect(resp.ok).toBe(false);
  });

  it('appends audit action via IPC', async () => {
    const resp = await sendRequest({
      type: 'audit.append',
      payload: {
        id: 'audit-ipc-001',
        memoryId: 'mem-001',
        action: 'activate',
        actorType: 'system',
        actorId: 'daemon',
        reason: 'auto',
        confidence: 0.95,
        sourceRefs: [],
        policyChecks: [],
        createdAt: '2026-06-12T10:00:00+08:00',
      } as any,
    });
    expect(resp.ok).toBe(true);
  });
});
