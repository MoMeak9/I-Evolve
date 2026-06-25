import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readSyncConfig } from './read-sync-config.js';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('readSyncConfig', () => {
  beforeEach(() => {
    delete process.env.IEVOLVE_PUSH_REPOS;
  });
  afterEach(() => vi.resetAllMocks());

  it('returns autoPush: false, pushRepos: [] when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: false, pushRepos: [] });
  });

  it('returns autoPush: true with empty pushRepos when no push_repos configured', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('schema_version: 1\nsync:\n  auto_push: true\n');
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: true, pushRepos: [] });
  });

  it('parses push_repos from yaml', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      'schema_version: 1\nsync:\n  auto_push: true\n  push_repos:\n    - app-kntr\n    - MoMeak9-I-Evolve\n',
    );
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({
      autoPush: true,
      pushRepos: ['app-kntr', 'MoMeak9-I-Evolve'],
    });
  });

  it('returns autoPush: false when sync section is missing', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('schema_version: 1\n');
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({ autoPush: false, pushRepos: [] });
  });

  it('uses IEVOLVE_PUSH_REPOS env var over yaml', () => {
    process.env.IEVOLVE_PUSH_REPOS = 'env-repo-1,env-repo-2';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      'schema_version: 1\nsync:\n  auto_push: true\n  push_repos:\n    - yaml-repo\n',
    );
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({
      autoPush: true,
      pushRepos: ['env-repo-1', 'env-repo-2'],
    });
  });

  it('treats empty env var as not configured', () => {
    process.env.IEVOLVE_PUSH_REPOS = '';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      'schema_version: 1\nsync:\n  auto_push: true\n  push_repos:\n    - yaml-repo\n',
    );
    expect(readSyncConfig('/fake/memory-pack.yaml')).toEqual({
      autoPush: true,
      pushRepos: ['yaml-repo'],
    });
  });
});
