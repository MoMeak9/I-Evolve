import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { listTrackedFiles } from '../scripts/backfill-static-memory.ts';

function tmpGitRepo(): string {
  const dir = join('/tmp', `ie-static-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(dir, 'ignored.txt'), 'nope\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

describe('listTrackedFiles', () => {
  it('returns tracked files and honors .gitignore', () => {
    const dir = tmpGitRepo();
    try {
      const files = listTrackedFiles(dir);
      expect(files).toContain('a.ts');
      expect(files).toContain('.gitignore');
      expect(files).not.toContain('ignored.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
