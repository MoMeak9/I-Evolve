import { describe, it, expect } from 'vitest';
import { snakeToCamel, camelToSnake, mapKeysSnakeToCamel, mapKeysCamelToSnake } from './mapping.js';

describe('snakeToCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(snakeToCamel('project_id')).toBe('projectId');
    expect(snakeToCamel('content_hash')).toBe('contentHash');
    expect(snakeToCamel('source_git_commit')).toBe('sourceGitCommit');
  });

  it('leaves single words unchanged', () => {
    expect(snakeToCamel('scope')).toBe('scope');
  });
});

describe('camelToSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnake('projectId')).toBe('project_id');
    expect(camelToSnake('contentHash')).toBe('content_hash');
    expect(camelToSnake('sourceGitCommit')).toBe('source_git_commit');
  });
});

describe('mapKeysSnakeToCamel', () => {
  it('maps all keys recursively', () => {
    const input = {
      project_id: 'test',
      applies_to: {
        repo_patterns: ['a'],
        path_patterns: ['b'],
      },
    };
    const result = mapKeysSnakeToCamel(input);
    expect(result).toEqual({
      projectId: 'test',
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
      projectId: 'test',
      appliesTo: {
        repoPatterns: ['a'],
      },
    };
    const result = mapKeysCamelToSnake(input);
    expect(result).toEqual({
      project_id: 'test',
      applies_to: {
        repo_patterns: ['a'],
      },
    });
  });
});
