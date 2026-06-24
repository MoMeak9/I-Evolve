import { describe, it, expect, vi, afterEach } from 'vitest';
import { readSyncConfig } from './read-sync-config.js';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('readSyncConfig', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns autoPush: false when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: false });
  });

  it('returns autoPush: true when file has auto_push: true', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('schema_version: 1\nsync:\n  auto_push: true\n');
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: true });
  });

  it('returns autoPush: false when sync section is missing', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('schema_version: 1\n');
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: false });
  });

  it('returns autoPush: false when auto_push field is missing', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('schema_version: 1\nsync:\n  auto_pull: true\n');
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: false });
  });
});
