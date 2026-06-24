import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoPushService } from './auto-push-service.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('./read-sync-config.js', () => ({
  readSyncConfig: vi.fn(),
}));

import { readSyncConfig } from './read-sync-config.js';

function makeMockGitSync(overrides: Partial<any> = {}) {
  return {
    isInitialized: vi.fn().mockReturnValue(true),
    hasRemote: vi.fn().mockReturnValue(true),
    push: vi.fn().mockResolvedValue({ ok: true, message: 'pushed', commit: 'abc123' }),
    ...overrides,
  };
}

describe('AutoPushService', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readSyncConfig).mockReturnValue({ autoPush: true });
  });
  afterEach(() => vi.resetAllMocks());

  it('pushes when auto_push=true, visibility=team, remote exists', async () => {
    const gitSync = makeMockGitSync();
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'team' });

    expect(gitSync.push).toHaveBeenCalledOnce();
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auto_push_success' }));
  });

  it('also pushes for visibility=public', async () => {
    const gitSync = makeMockGitSync();
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'public' });

    expect(gitSync.push).toHaveBeenCalledOnce();
  });

  it('skips when auto_push=false', async () => {
    vi.mocked(readSyncConfig).mockReturnValue({ autoPush: false });
    const gitSync = makeMockGitSync();
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'team' });

    expect(gitSync.push).not.toHaveBeenCalled();
  });

  it('skips when visibility=private', async () => {
    const gitSync = makeMockGitSync();
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'private' });

    expect(gitSync.push).not.toHaveBeenCalled();
  });

  it('skips when no remote configured', async () => {
    const gitSync = makeMockGitSync({ hasRemote: vi.fn().mockReturnValue(false) });
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'team' });

    expect(gitSync.push).not.toHaveBeenCalled();
  });

  it('enqueues on push failure', async () => {
    const gitSync = makeMockGitSync({
      push: vi.fn().mockResolvedValue({ ok: false, message: 'validation failed' }),
    });
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'team' });

    expect(writeFileSync).toHaveBeenCalledWith(
      '/mem/.pending-push.json',
      expect.stringContaining('test-1'),
      'utf-8',
    );
    expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auto_push_failed' }));
  });

  it('does not enqueue duplicate memoryId', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify([
      { memoryId: 'test-1', reason: 'promotion', failedAt: '2026-06-24T00:00:00Z', attempts: 1, lastError: 'net' },
    ]));
    const gitSync = makeMockGitSync({
      push: vi.fn().mockResolvedValue({ ok: false, message: 'fail' }),
    });
    const appendAudit = vi.fn();
    const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

    await svc.onPromoted({ id: 'test-1', visibility: 'team' });

    // Dedup guard prevents writing when memoryId is already queued
    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const queueWrites = writeCalls.filter(([path]) => path === '/mem/.pending-push.json');
    // Either no write happened (pure dedup), or the written queue has exactly one entry
    if (queueWrites.length > 0) {
      const queue = JSON.parse(queueWrites[0][1] as string);
      expect(queue.filter((e: any) => e.memoryId === 'test-1')).toHaveLength(1);
    } else {
      expect(queueWrites).toHaveLength(0);
    }
  });

  describe('flush', () => {
    it('returns zeros when queue is empty', async () => {
      const gitSync = makeMockGitSync();
      const appendAudit = vi.fn();
      const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

      const result = await svc.flush();

      expect(result).toEqual({ pushed: 0, failed: 0 });
      expect(gitSync.push).not.toHaveBeenCalled();
    });

    it('clears queue on successful push', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify([
        { memoryId: 'old-1', reason: 'promotion', failedAt: '2026-06-24T00:00:00Z', attempts: 1, lastError: 'net' },
      ]));
      const gitSync = makeMockGitSync();
      const appendAudit = vi.fn();
      const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

      const result = await svc.flush();

      expect(result).toEqual({ pushed: 1, failed: 0 });
      expect(writeFileSync).toHaveBeenCalledWith('/mem/.pending-push.json', '[]', 'utf-8');
    });

    it('increments attempts on failed push', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify([
        { memoryId: 'old-1', reason: 'promotion', failedAt: '2026-06-24T00:00:00Z', attempts: 1, lastError: 'net' },
      ]));
      const gitSync = makeMockGitSync({
        push: vi.fn().mockResolvedValue({ ok: false, message: 'network error' }),
      });
      const appendAudit = vi.fn();
      const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

      const result = await svc.flush();

      expect(result).toEqual({ pushed: 0, failed: 1 });
      const written = vi.mocked(writeFileSync).mock.calls[0]?.[1] as string;
      const queue = JSON.parse(written);
      expect(queue[0].attempts).toBe(2);
    });

    it('abandons entries exceeding max attempts', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify([
        { memoryId: 'old-1', reason: 'promotion', failedAt: '2026-06-24T00:00:00Z', attempts: 5, lastError: 'net' },
      ]));
      const gitSync = makeMockGitSync({
        push: vi.fn().mockResolvedValue({ ok: false, message: 'still failing' }),
      });
      const appendAudit = vi.fn();
      const svc = new AutoPushService(gitSync as any, '/mem/memory-pack.yaml', '/mem/.pending-push.json', appendAudit);

      const result = await svc.flush();

      expect(result).toEqual({ pushed: 0, failed: 0 });
      expect(appendAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auto_push_abandoned' }));
      expect(writeFileSync).toHaveBeenCalledWith('/mem/.pending-push.json', '[]', 'utf-8');
    });
  });
});
