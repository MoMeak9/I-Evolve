import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ModelManager } from './model-manager.js';

const root = join('/tmp', `ie-model-${randomBytes(4).toString('hex')}`);
let mgr: ModelManager;

beforeEach(() => {
  mkdirSync(root, { recursive: true });
  mgr = new ModelManager(root, '2026-06-18T00:00:00.000Z');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ModelManager', () => {
  it('writes a lock with real dimension and marks profile active', () => {
    mgr.writeLock('lite', 384, 'rev-abc');
    const lockPath = join(root, 'models', 'intfloat', 'multilingual-e5-small', 'model.lock.yaml');
    expect(existsSync(lockPath)).toBe(true);
    const text = readFileSync(lockPath, 'utf-8');
    expect(text).toContain('model_id: intfloat/multilingual-e5-small');
    expect(text).toContain('dimension: 384');
    expect(text).toContain('active: true');
  });

  it('status reports installed=false before install, true after', () => {
    expect(mgr.status('lite').installed).toBe(false);
    mgr.writeLock('lite', 384, 'rev-abc');
    expect(mgr.status('lite').installed).toBe(true);
  });

  it('switch flips active flag across profiles', () => {
    mgr.writeLock('lite', 384, 'r1');
    mgr.writeLock('default', 1024, 'r2');
    mgr.switch('default');
    expect(mgr.activeProfile()).toBe('default');
    expect(mgr.status('lite').active).toBe(false);
    expect(mgr.status('default').active).toBe(true);
  });
});
