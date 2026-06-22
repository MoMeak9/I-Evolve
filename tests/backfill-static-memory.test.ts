import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { listTrackedFiles, summarizeDocs } from '../scripts/backfill-static-memory.ts';
import { scanModules } from '../scripts/backfill-static-memory.ts';
import { probeFileHeads } from '../scripts/backfill-static-memory.ts';
import { buildContextPack } from '../scripts/backfill-static-memory.ts';
import { validateCandidates, detectIntraBatchCollisions } from '../scripts/backfill-static-memory.ts';
import { idForCandidate, mergeStaticSourceRefs } from '../scripts/backfill-static-memory.ts';
import { partitionByExistingIds } from '../scripts/backfill-static-memory.ts';

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

describe('validateCandidates', () => {
  it('keeps valid candidates and drops malformed ones with reasons', () => {
    const raw = [
      { title: 'ok', type: 'repo_fact', proposedScope: 'repo', content: 'c', confidence: 0.8, sourceRefs: [], evidence: [], riskFlags: [] },
      { title: '', type: 'repo_fact', proposedScope: 'repo', content: 'c', confidence: 0.8 },
      { title: 'no content', type: 'repo_fact', proposedScope: 'repo', content: '', confidence: 0.5 },
      { title: 'bad type', type: 'nope', proposedScope: 'repo', content: 'c', confidence: 0.8 },
      { title: 'bad scope', type: 'decision', proposedScope: 'galaxy', content: 'c', confidence: 0.8 },
      { title: 'bad conf', type: 'decision', proposedScope: 'repo', content: 'c', confidence: 2 },
      { title: 'nan conf', type: 'decision', proposedScope: 'repo', content: 'c', confidence: NaN },
    ];
    const { valid, dropped } = validateCandidates(raw);
    expect(valid.map((c) => c.title)).toEqual(['ok']);
    expect(dropped).toHaveLength(6);
    expect(dropped.map((d) => d.reason)).toEqual([
      'empty title',
      'empty content',
      'invalid type: nope',
      'invalid proposedScope: galaxy',
      'invalid confidence: 2',
      'invalid confidence: NaN',
    ]);
    expect(dropped[0].title).toBe('(no title)');
  });
});

describe('detectIntraBatchCollisions', () => {
  it('keeps first, skips later colliding ids', () => {
    const idFn = (c: { title: string }) => `repo.x.${c.title}`;
    const cands = [
      { title: 'a', type: 'repo_fact', proposedScope: 'repo', content: '1', confidence: 0.8, sourceRefs: [], evidence: [], riskFlags: [] },
      { title: 'a', type: 'repo_fact', proposedScope: 'repo', content: '2', confidence: 0.8, sourceRefs: [], evidence: [], riskFlags: [] },
      { title: 'b', type: 'repo_fact', proposedScope: 'repo', content: '3', confidence: 0.8, sourceRefs: [], evidence: [], riskFlags: [] },
    ] as any;
    const { kept, skipped } = detectIntraBatchCollisions(cands, idFn as any);
    expect(kept.map((c) => c.content)).toEqual(['1', '3']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].id).toBe('repo.x.a');
  });
});

describe('idForCandidate', () => {
  it('slugifies ascii titles', () => {
    const c = { title: 'Use Redis Cache', repoId: 'org/repo', sourceRefs: [] } as any;
    expect(idForCandidate(c, 'repo')).toBe('repo.org-repo.use-redis-cache');
  });
  it('falls back to sha+hash for non-ascii titles (no collision)', () => {
    const a = { title: '使用缓存', repoId: 'org/repo', sourceRefs: ['abc1234'] } as any;
    const b = { title: '另一个决策', repoId: 'org/repo', sourceRefs: ['abc1234'] } as any;
    expect(idForCandidate(a, 'repo')).not.toBe(idForCandidate(b, 'repo'));
    expect(idForCandidate(a, 'repo').startsWith('repo.org-repo.')).toBe(true);
  });
});

describe('mergeStaticSourceRefs', () => {
  it('appends the snapshot marker, dedup, preserves candidate refs', () => {
    const refs = mergeStaticSourceRefs(['README.md#Architecture'], 'org/repo@static:1e14647');
    expect(refs).toContain('README.md#Architecture');
    expect(refs).toContain('org/repo@static:1e14647');
    expect(mergeStaticSourceRefs(['org/repo@static:1e14647'], 'org/repo@static:1e14647')).toHaveLength(1);
  });
});

describe('partitionByExistingIds', () => {
  it('skips candidates whose computed id already exists, incl. non-ascii titles', () => {
    const asciiKnown = { title: 'Use Redis Cache', type: 'repo_fact', proposedScope: 'repo', content: 'c', confidence: 0.8, repoId: 'org/repo', sourceRefs: [], evidence: [], riskFlags: [] } as any;
    const zhFresh = { title: '使用模块化分包架构', type: 'repo_fact', proposedScope: 'repo', content: 'c', confidence: 0.85, repoId: 'org/repo', sourceRefs: [], evidence: [], riskFlags: [] } as any;
    const zhKnown = { title: '采用单仓多包', type: 'repo_fact', proposedScope: 'repo', content: 'c', confidence: 0.85, repoId: 'org/repo', sourceRefs: [], evidence: [], riskFlags: [] } as any;

    // store contains the ascii title's id and the zhKnown title's id — but NOT zhFresh's id.
    const existingIds = new Set([
      idForCandidate(asciiKnown, 'repo'),
      idForCandidate(zhKnown, 'repo'),
    ]);

    const { fresh, alreadyKnown } = partitionByExistingIds(
      [asciiKnown, zhFresh, zhKnown],
      existingIds,
      idForCandidate,
    );

    // zhFresh's id is NOT in the store, so it must survive — proving the empty-slug
    // "matches every id" bug is gone (slugify('使用模块化分包架构') === '' would have
    // falsely flagged it duplicate against the unrelated ascii/zhKnown ids).
    expect(fresh.map((c) => c.title)).toEqual(['使用模块化分包架构']);
    expect(alreadyKnown.map((k) => k.title).sort()).toEqual(['Use Redis Cache', '采用单仓多包']);
    expect(alreadyKnown.find((k) => k.title === '采用单仓多包')!.id).toBe(idForCandidate(zhKnown, 'repo'));
  });
});
