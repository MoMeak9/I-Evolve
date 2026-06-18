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
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function main(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === 'pack') {
    console.log('pack: not yet implemented');
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
