import { describe, it, expect } from 'vitest';
import { snakeToCamel, camelToSnake, mapKeysSnakeToCamel, mapKeysCamelToSnake } from './mapping.js';

describe('snakeToCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(snakeToCamel('repo_id')).toBe('repoId');
    expect(snakeToCamel('content_hash')).toBe('contentHash');
    expect(snakeToCamel('source_git_commit')).toBe('sourceGitCommit');
  });

  it('leaves single words unchanged', () => {
    expect(snakeToCamel('scope')).toBe('scope');
  });
});

describe('camelToSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnake('repoId')).toBe('repo_id');
    expect(camelToSnake('contentHash')).toBe('content_hash');
    expect(camelToSnake('sourceGitCommit')).toBe('source_git_commit');
  });
});

describe('mapKeysSnakeToCamel', () => {
  it('maps all keys recursively', () => {
    const input = {
      repo_id: 'acme/test',
      applies_to: {
        repo_patterns: ['a'],
        path_patterns: ['b'],
      },
    };
    const result = mapKeysSnakeToCamel(input);
    expect(result).toEqual({
      repoId: 'acme/test',
      appliesTo: {
        repoPatterns: ['a'],
        pathPatterns: ['b'],
      },
    });
  });
});

describe('mapKeysCamelToSnake', () => {
  it('maps all keys recursively', () => {
    const input = {
      repoId: 'acme/test',
      appliesTo: {
        repoPatterns: ['a'],
      },
    };
    const result = mapKeysCamelToSnake(input);
    expect(result).toEqual({
      repo_id: 'acme/test',
      applies_to: {
        repo_patterns: ['a'],
      },
    });
  });
});
