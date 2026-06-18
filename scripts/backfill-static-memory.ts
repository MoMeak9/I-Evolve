#!/usr/bin/env -S pnpm tsx
/**
 * backfill-static-memory.ts
 *
 * 迁移仓库（commit 历史被截断、无 MR）的静态快照回填。pack 扫描仓库产出
 * 「清单+摘要」JSON 供 subagent 精读；inject 收 subagent 产出的 candidate
 * JSON，喂 MockAiProvider 跑真实 EvolutionPipeline（judge→audit→write）。
 * 不 commit、不 push。详见 docs/superpowers/specs/2026-06-18-static-memory-backfill-design.md
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRepoIdentity } from '@i-evolve/storage';
import type { CandidateMemory } from '@i-evolve/core';
import type { MemoryScope, MemoryType } from '@i-evolve/shared';

// ---- pack 区（Task 3-5 填充）----

/** git-tracked + 未被 .gitignore 排除的文件（相对路径，已含已 add 的新文件）。 */
export function listTrackedFiles(repo: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: repo, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

export interface DocSummary {
  path: string;
  kind: 'readme' | 'changelog';
  headings?: string[];
  excerpt?: string;
  versions?: string[];
}

const EXCERPT_LINES = 20;
const VERSION_RE = /^##\s+\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*|Unreleased)\]?/i;

export function summarizeDocs(repo: string, files: string[]): DocSummary[] {
  const out: DocSummary[] = [];
  for (const rel of files) {
    const lower = basename(rel).toLowerCase();
    const isReadme = lower === 'readme.md' || lower === 'readme';
    const isChangelog = lower.startsWith('changelog');
    if (!isReadme && !isChangelog) continue;
    let raw: string;
    try {
      raw = readFileSync(join(repo, rel), 'utf-8');
    } catch {
      continue; // 单文件读失败：跳过
    }
    const lines = raw.split('\n');
    if (isReadme) {
      const headings = lines
        .map((l) => l.match(/^#{1,3}\s+(.+)/)?.[1]?.trim())
        .filter((h): h is string => Boolean(h));
      out.push({ path: rel, kind: 'readme', headings, excerpt: lines.slice(0, EXCERPT_LINES).join('\n') });
    } else {
      const versions = lines
        .map((l) => l.match(VERSION_RE)?.[1])
        .filter((v): v is string => Boolean(v));
      out.push({ path: rel, kind: 'changelog', versions });
    }
  }
  return out;
}

export interface ModuleInfo {
  path: string;
  name: string;
  manifest: { deps: string[]; scripts: Record<string, string> };
  readmePath?: string;
}

export function scanModules(repo: string, files: string[]): ModuleInfo[] {
  const readmeByDir = new Map<string, string>();
  for (const f of files) {
    if (basename(f).toLowerCase().startsWith('readme')) readmeByDir.set(dirname(f), f);
  }
  const mods: ModuleInfo[] = [];
  for (const f of files) {
    if (basename(f) !== 'package.json') continue;
    let pkg: { name?: string; dependencies?: Record<string, string>; scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(join(repo, f), 'utf-8'));
    } catch {
      continue; // 坏 manifest：跳过
    }
    const dir = dirname(f);
    mods.push({
      path: dir,
      name: pkg.name ?? basename(dir),
      manifest: { deps: Object.keys(pkg.dependencies ?? {}), scripts: pkg.scripts ?? {} },
      readmePath: readmeByDir.get(dir),
    });
  }
  return mods;
}

export interface FileHead {
  path: string;
  hasHeaderDoc: boolean;
  exports: string[];
}

const SRC_EXT = /\.(ts|tsx|js|jsx|mts|cts|go|py|java|kt|rs)$/;
const HEAD_SCAN_LINES = 40;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/;

export function probeFileHeads(repo: string, files: string[]): FileHead[] {
  const out: FileHead[] = [];
  for (const rel of files) {
    if (!SRC_EXT.test(rel)) continue;
    let raw: string;
    try {
      raw = readFileSync(join(repo, rel), 'utf-8');
    } catch {
      continue; // 单文件读失败：跳过
    }
    const head = raw.split('\n').slice(0, HEAD_SCAN_LINES);
    const hasHeaderDoc = /^\s*(\/\*\*|\/\/|#|""")/.test(head[0] ?? '');
    const exports: string[] = [];
    for (const line of raw.split('\n')) {
      const m = line.match(EXPORT_RE);
      if (m) exports.push(m[1]);
    }
    out.push({ path: rel, hasHeaderDoc, exports });
  }
  return out;
}
// ---- inject 区（Task 6-7 填充）----

const TYPES: MemoryType[] = ['repo_fact', 'task_constraint', 'decision', 'pitfall', 'workflow_rule'];
const SCOPES: MemoryScope[] = ['global', 'domain', 'repo', 'task'];

export interface DroppedCandidate { title: string; reason: string }

/** 逐条预校验：坏条目剔除（带原因），避免一条脏数据 throw 中断整批 (§6.3)。 */
export function validateCandidates(raw: unknown[]): { valid: CandidateMemory[]; dropped: DroppedCandidate[] } {
  const valid: CandidateMemory[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const item of raw) {
    const c = item as Partial<CandidateMemory>;
    const title = typeof c.title === 'string' ? c.title : '';
    const reason =
      !title ? 'empty title'
      : !c.content || typeof c.content !== 'string' ? 'empty content'
      : !TYPES.includes(c.type as MemoryType) ? `invalid type: ${String(c.type)}`
      : !SCOPES.includes(c.proposedScope as MemoryScope) ? `invalid proposedScope: ${String(c.proposedScope)}`
      : typeof c.confidence !== 'number' || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1 ? `invalid confidence: ${String(c.confidence)}`
      : '';
    if (reason) {
      dropped.push({ title: title || '(no title)', reason });
      continue;
    }
    valid.push({
      title,
      type: c.type as MemoryType,
      proposedScope: c.proposedScope as MemoryScope,
      content: c.content as string,
      evidence: c.evidence ?? [],
      sourceRefs: c.sourceRefs ?? [],
      confidence: c.confidence as number,
      riskFlags: c.riskFlags ?? [],
      repoId: c.repoId,
      domain: c.domain,
    });
  }
  return { valid, dropped };
}

export interface SkippedCandidate { id: string; title: string }

/** 同一批内算出相同 id：保留首条，跳过后者，绝不静默覆盖 (§6.2)。 */
export function detectIntraBatchCollisions(
  cands: CandidateMemory[],
  idFn: (c: CandidateMemory, scope: MemoryScope) => string,
): { kept: CandidateMemory[]; skipped: SkippedCandidate[] } {
  const seen = new Set<string>();
  const kept: CandidateMemory[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const c of cands) {
    const id = idFn(c, c.proposedScope);
    if (seen.has(id)) {
      skipped.push({ id, title: c.title });
    } else {
      seen.add(id);
      kept.push(c);
    }
  }
  return { kept, skipped };
}

/** 照搬 inject-pr-candidates.ts：非 ASCII 标题 slug 为空时回退 <sha>-<titlehash>。 */
export function idForCandidate(c: CandidateMemory, scope: MemoryScope): string {
  const ns = (c.repoId ?? 'unknown').replace(/\//g, '-');
  const sha = (c.sourceRefs ?? []).find((r) => /^[0-9a-f]{7,40}$/.test(r))?.slice(0, 7) ?? 'x';
  let h = 0;
  for (const ch of c.title ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const suffix = `${sha}-${h.toString(36)}`;
  let slug = (c.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) slug = suffix;
  return `${scope}.${ns}.${slug}`;
}

/** 把 HEAD 快照标记并入 sourceRefs（去重），保留 candidate 自身的文件/文档锚点。 */
export function mergeStaticSourceRefs(candidateRefs: string[], snapshotMarker: string): string[] {
  return [...new Set([...candidateRefs, snapshotMarker])];
}

export interface StaticContextPack {
  repoId: string;
  domain?: string;
  headSha: string;
  generatedAt: string;
  tree: string[];
  modules: ModuleInfo[];
  docs: DocSummary[];
  fileHeads: FileHead[];
  truncated: boolean;
}

const DEFAULT_MAX_FILES = 2000;

function headSha(repo: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
  } catch {
    return ''; // 无 commit（如全新仓库）：不抛，留空
  }
}

/** manifest 所在目录文件优先，其余其次；用于 maxFiles 截断时保住高价值文件。 */
function prioritizeFiles(files: string[]): string[] {
  const manifestDirs = new Set(
    files.filter((f) => basename(f) === 'package.json').map((f) => dirname(f)),
  );
  const inManifestDir = (f: string) => manifestDirs.has(dirname(f));
  return [...files].sort((a, b) => Number(inManifestDir(b)) - Number(inManifestDir(a)));
}

export function buildContextPack(
  repo: string,
  opts: { maxFiles?: number; domain?: string } = {},
): StaticContextPack {
  const maxFiles = Number.isFinite(opts.maxFiles) ? (opts.maxFiles as number) : DEFAULT_MAX_FILES;
  const identity = detectRepoIdentity({ cwd: repo, manualDomain: opts.domain });
  const all = listTrackedFiles(repo);
  const prioritized = prioritizeFiles(all);
  const truncated = prioritized.length > maxFiles;
  const tree = prioritized.slice(0, maxFiles);

  return {
    repoId: identity.repoId,
    domain: identity.domain,
    headSha: headSha(repo),
    generatedAt: new Date().toISOString(),
    tree,
    modules: scanModules(repo, tree),
    docs: summarizeDocs(repo, tree),
    fileHeads: probeFileHeads(repo, tree),
    truncated,
  };
}

interface PackArgs { repo: string; out?: string; maxFiles?: number; domain?: string }

function parsePackArgs(argv: string[]): PackArgs {
  const a: PackArgs = { repo: process.cwd() };
  for (let i = 1; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--repo': a.repo = next(); break;
      case '--out': a.out = next(); break;
      case '--max-files': a.maxFiles = Number(next()); break;
      case '--domain': a.domain = next(); break;
    }
  }
  return a;
}

function runPack(argv: string[]): void {
  const args = parsePackArgs(argv);
  if (!existsSync(join(args.repo, '.git'))) {
    console.error(`Not a git repo: ${args.repo}`);
    process.exit(1);
  }
  let pack: StaticContextPack;
  try {
    pack = buildContextPack(args.repo, { maxFiles: args.maxFiles, domain: args.domain });
  } catch (err) {
    console.error(`pack failed: ${(err as Error).message}`);
    process.exit(1);
  }
  if (pack.truncated) {
    console.error(`⚠  tree truncated to ${pack.tree.length} files (--max-files); consider 分批处理.`);
  }
  const json = JSON.stringify(pack, null, 2);
  if (args.out) {
    writeFileSync(args.out, json, 'utf-8');
    console.error(`pack written to ${args.out} (${pack.tree.length} files, ${pack.modules.length} modules)`);
  } else {
    process.stdout.write(json + '\n');
  }
}

export async function main(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === 'pack') {
    runPack(argv);
  } else if (sub === 'inject') {
    console.log('inject: not yet implemented');
  } else {
    console.error('Usage: backfill-static-memory.ts <pack|inject> [options]');
    process.exit(2);
  }
}

// 仅当作为入口运行时执行 main；被测试 import 时不执行。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
