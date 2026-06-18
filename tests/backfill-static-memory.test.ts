import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { listTrackedFiles, summarizeDocs } from '../scripts/backfill-static-memory.ts';
import { scanModules } from '../scripts/backfill-static-memory.ts';
import { probeFileHeads } from '../scripts/backfill-static-memory.ts';
import { buildContextPack } from '../scripts/backfill-static-memory.ts';

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

describe('summarizeDocs', () => {
  it('extracts README headings/excerpt and CHANGELOG versions', () => {
    const dir = join('/tmp', `ie-docs-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'README.md'),
        '# Title\nintro line\n## Architecture\nmore\n');
      writeFileSync(join(dir, 'CHANGELOG.md'),
        '## [1.2.0]\n### Added\n- x\n## [1.1.0]\n- y\n');
      const docs = summarizeDocs(dir, ['README.md', 'CHANGELOG.md']);
      const readme = docs.find((d) => d.kind === 'readme')!;
      expect(readme.headings).toContain('Architecture');
      expect(readme.excerpt).toContain('intro line');
      const cl = docs.find((d) => d.kind === 'changelog')!;
      expect(cl.versions).toEqual(['1.2.0', '1.1.0']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scanModules', () => {
  it('reads package.json deps/scripts and links sibling README', () => {
    const dir = join('/tmp', `ie-mods-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(dir, 'packages/core'), { recursive: true });
    try {
      writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({
        name: '@x/core', dependencies: { dep: '1' }, scripts: { build: 'tsc' },
      }));
      writeFileSync(join(dir, 'packages/core/README.md'), '# core\n');
      const mods = scanModules(dir, ['packages/core/package.json', 'packages/core/README.md']);
      expect(mods).toHaveLength(1);
      expect(mods[0].name).toBe('@x/core');
      expect(mods[0].path).toBe('packages/core');
      expect(mods[0].manifest.deps).toContain('dep');
      expect(mods[0].manifest.scripts.build).toBe('tsc');
      expect(mods[0].readmePath).toBe('packages/core/README.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('probeFileHeads', () => {
  it('flags header doc and lists export names, no comment body', () => {
    const dir = join('/tmp', `ie-heads-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'foo.ts'),
        '/**\n * file header\n */\nexport function fooBar() {}\nexport const baz = 1;\n');
      writeFileSync(join(dir, 'bare.ts'), 'const x = 1;\n');
      const heads = probeFileHeads(dir, ['foo.ts', 'bare.ts', 'README.md']);
      const foo = heads.find((h) => h.path === 'foo.ts')!;
      expect(foo.hasHeaderDoc).toBe(true);
      expect(foo.exports).toEqual(['fooBar', 'baz']);
      const bare = heads.find((h) => h.path === 'bare.ts')!;
      expect(bare.hasHeaderDoc).toBe(false);
      expect(bare.exports).toEqual([]);
      expect(heads.find((h) => h.path === 'README.md')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildContextPack', () => {
  it('assembles pack and truncates tree at maxFiles, manifest dirs first', () => {
    const dir = join('/tmp', `ie-pack-${randomBytes(4).toString('hex')}`);
    mkdirSync(join(dir, 'packages/core'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    try {
      writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({ name: '@x/core' }));
      writeFileSync(join(dir, 'README.md'), '# Root\n');
      writeFileSync(join(dir, 'z-extra.ts'), 'const z=1;\n');
      execFileSync('git', ['add', '-A'], { cwd: dir });
      const pack = buildContextPack(dir, { maxFiles: 2 });
      expect(pack.headSha).toBe(''); // 无 commit 时 HEAD 取不到 → 空串(不抛)
      expect(pack.modules.map((m) => m.name)).toContain('@x/core');
      expect(pack.docs.some((d) => d.kind === 'readme')).toBe(true);
      expect(pack.tree.length).toBe(2);
      expect(pack.truncated).toBe(true);
      expect(pack.tree).toContain('packages/core/package.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
