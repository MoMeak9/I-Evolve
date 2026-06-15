import { describe, expect, it } from 'vitest';
import { parseGitRemotes } from '../apps/cli/src/commands/init.js';

describe('init: parseGitRemotes', () => {
  it('extracts unique fetch remotes', () => {
    const output = [
      'origin\thttps://github.com/acme/app.git (fetch)',
      'origin\thttps://github.com/acme/app.git (push)',
      'upstream\tgit@github.com:acme/upstream.git (fetch)',
      'upstream\tgit@github.com:acme/upstream.git (push)',
    ].join('\n');

    expect(parseGitRemotes(output)).toEqual([
      { name: 'origin', url: 'https://github.com/acme/app.git' },
      { name: 'upstream', url: 'git@github.com:acme/upstream.git' },
    ]);
  });

  it('returns an empty list when there are no remotes', () => {
    expect(parseGitRemotes('')).toEqual([]);
  });

  it('ignores push lines and keeps only fetch entries', () => {
    const output = 'origin\thttps://example.com/repo.git (push)';
    expect(parseGitRemotes(output)).toEqual([]);
  });
});
