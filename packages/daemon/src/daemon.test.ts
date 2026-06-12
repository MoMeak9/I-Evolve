import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setBasePath, paths } from './paths.js';
import { Daemon } from './daemon.js';
import { sendRequest } from './ipc-client.js';
import { ObservationWriter } from './observation-writer.js';
import { AuditWriter } from './audit-writer.js';
import { MarkdownMemoryRepository } from '@i-evolve/storage';

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

describe('Daemon memory API', () => {
  let daemon: Daemon;

  beforeEach(async () => {
    mkdirSync(paths.shared.dir, { recursive: true });
    const repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });
    repo.create({
      id: 'project.demo.ssr-rule',
      type: 'project_fact',
      scope: 'project',
      projectId: 'demo',
      title: 'SSR Rule',
      content: 'SSR hydration must be reviewed before release.',
      status: 'active',
      visibility: 'team',
      confidence: 0.91,
      ttlDays: 90,
      tags: ['ssr'],
      sourceRefs: ['test'],
    });
    repo.close();

    daemon = new Daemon();
    await daemon.start();
  });

  afterEach(async () => {
    try { await daemon.stop(); } catch {}
  });

  it('recalls context and memory provenance through daemon IPC', async () => {
    const resp = await sendRequest<{ context: string; memories: Array<{ id: string; reason: string }> }>({
      type: 'memory.recall',
      payload: {
        query: 'SSR hydration',
        cwd: testDir,
        projectId: 'demo',
        maxTokens: 2000,
      },
    } as any);

    expect(resp.ok).toBe(true);
    expect(resp.data?.context).toContain('# I-Evolve Context');
    expect(resp.data?.context).toContain('SSR hydration must be reviewed');
    expect(resp.data?.memories[0].id).toBe('project.demo.ssr-rule');
    expect(resp.data?.memories[0].reason).toContain('project');
  });

  it('searches active memory through daemon IPC using FTS', async () => {
    const resp = await sendRequest<Array<{ id: string; scope: string; confidence: number; reason: string }>>({
      type: 'memory.search',
      payload: { query: 'hydration' },
    } as any);

    expect(resp.ok).toBe(true);
    expect(resp.data?.[0]).toMatchObject({
      id: 'project.demo.ssr-rule',
      scope: 'project',
      confidence: 0.91,
    });
  });

  it('serializes remember and forget writes through daemon transactions and writes audit', async () => {
    const remembered = await sendRequest<{ memoryId: string; auditId: string }>({
      type: 'memory.remember',
      payload: {
        content: 'Always run release smoke tests for dashboard changes.',
        cwd: testDir,
        projectId: 'demo',
      },
    } as any);
    expect(remembered.ok).toBe(true);
    expect(remembered.data?.memoryId).toMatch(/^project\.demo\./);

    const forgotten = await sendRequest<{ auditId: string }>({
      type: 'memory.forget',
      payload: { memoryId: remembered.data?.memoryId, mode: 'soft' },
    } as any);
    expect(forgotten.ok).toBe(true);

    const repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });
    const memory = repo.get(remembered.data!.memoryId);
    repo.close();
    expect(memory?.status).toBe('deprecated');

    const audit = readFileSync(paths.audit.current, 'utf-8');
    expect(audit).toContain(remembered.data!.auditId);
    expect(audit).toContain(forgotten.data!.auditId);
  });

  it('returns audit, explanation, dashboard summary, and rebuild result', async () => {
    await sendRequest({
      type: 'audit.append',
      payload: {
        id: 'audit-demo-001',
        memoryId: 'project.demo.ssr-rule',
        action: 'activate',
        actorType: 'system',
        actorId: 'daemon-test',
        reason: 'seeded for test',
        confidence: 1,
        sourceRefs: [],
        policyChecks: [{ policy: 'test', passed: true }],
        createdAt: '2026-06-12T10:00:00+08:00',
      } as any,
    });

    const audit = await sendRequest<unknown[]>({
      type: 'memory.audit',
      payload: { memoryId: 'project.demo.ssr-rule' },
    } as any);
    expect(audit.ok).toBe(true);
    expect(audit.data).toHaveLength(1);

    const explanation = await sendRequest<{ explanation: string }>({
      type: 'memory.explain',
      payload: { memoryId: 'project.demo.ssr-rule' },
    } as any);
    expect(explanation.data?.explanation).toContain('seeded for test');

    const dashboard = await sendRequest<{ memories: unknown[]; audit: unknown[]; conflicts: unknown[]; git: unknown }>({
      type: 'dashboard.summary',
      payload: {},
    } as any);
    expect(dashboard.ok).toBe(true);
    expect(dashboard.data?.memories).toHaveLength(1);
    expect(dashboard.data?.audit).toHaveLength(1);
    expect(dashboard.data?.git).toBeDefined();

    const rebuild = await sendRequest<{ total: number; errors: number }>({
      type: 'index.rebuild',
      payload: {},
    } as any);
    expect(rebuild.ok).toBe(true);
    expect(rebuild.data?.total).toBeGreaterThanOrEqual(1);
  });
});
