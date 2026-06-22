#!/usr/bin/env -S pnpm tsx
/**
 * diagnose-memory.ts
 *
 * Read-only self-check for the git memory store before commit/push. Wraps the
 * packaged validateMemoryRepo (pack file present, frontmatter schema valid, ids
 * unique repo-wide, no secrets/PII, no camelCase keys, content_hash matches)
 * and adds a few backfill-specific checks the packaged validator does not do:
 *   - empty/degenerate slug filenames (`.md`, trailing-dot ids)
 *   - per-repo memory counts (sanity: did a repo write what we expect?)
 *   - expired-on-write detection (expires_at already in the past)
 *
 * Never writes, commits, or pushes. Exit code 0 = clean, 1 = issues found.
 *
 * Usage:
 *   pnpm tsx --tsconfig scripts/tsconfig.json scripts/diagnose-memory.ts
 *   pnpm tsx --tsconfig scripts/tsconfig.json scripts/diagnose-memory.ts --repo-id platform/go-cosmo-conn
 *
 * Operates on ~/.i-evolve (or $IEVOLVE_BASE_PATH).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { validateMemoryRepo } from '@i-evolve/git-sync';

interface Args {
  repoId?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-id') a.repoId = argv[++i];
  }
  return a;
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '.git' || entry === 'tombstones' || entry === 'audit') continue;
        walk(full);
      } else if (entry.endsWith('.md') && entry !== 'README.md' && entry !== 'CHANGELOG.md') {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function frontmatter(file: string): Record<string, string> {
  const text = readFileSync(file, 'utf-8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = paths.shared.memory;
  console.log(`memory repo: ${repoRoot}`);
  if (!existsSync(repoRoot)) {
    console.error('Memory repo does not exist.');
    process.exit(1);
  }

  let problems = 0;

  // 1) Packaged validator (authoritative pre-push gate).
  const report = validateMemoryRepo(repoRoot);
  console.log(`\n[validateMemoryRepo] checked ${report.checkedFiles} files, ok=${report.ok}`);
  if (report.issues.length) {
    problems += report.issues.length;
    for (const i of report.issues) console.log(`  x ${i.file}: ${i.problem}`);
  } else {
    console.log('  ok - no schema/secret/id/hash issues');
  }

  // 2) Backfill-specific structural checks.
  const files = listMarkdown(repoRoot);
  const nowMs = Date.parse(new Date().toISOString());
  const perRepo = new Map<string, number>();
  const badSlug: string[] = [];
  const expired: string[] = [];

  for (const f of files) {
    const base = f.slice(repoRoot.length + 1);
    if (/(^|\/)\.md$/.test(f) || /\.\.md$/.test(f)) badSlug.push(base);
    const fm = frontmatter(f);
    if (fm.repo_id) perRepo.set(fm.repo_id, (perRepo.get(fm.repo_id) ?? 0) + 1);
    if (fm.id && fm.id.endsWith('.')) badSlug.push(`${base} (id ends with '.')`);
    if (fm.expires_at && Date.parse(fm.expires_at) < nowMs) expired.push(`${base} (expires_at ${fm.expires_at})`);
  }

  console.log(`\n[structural] scanned ${files.length} markdown files`);
  if (badSlug.length) {
    problems += badSlug.length;
    console.log('  x degenerate slug/id:');
    for (const b of badSlug) console.log(`      ${b}`);
  } else {
    console.log('  ok - no degenerate slug/id filenames');
  }
  if (expired.length) {
    console.log(`  warn - ${expired.length} memory(ies) already expired (informational):`);
    for (const e of expired.slice(0, 5)) console.log(`      ${e}`);
    if (expired.length > 5) console.log(`      ... and ${expired.length - 5} more`);
  } else {
    console.log('  ok - no memories expired-on-write');
  }

  console.log('\n[per-repo counts]');
  const repos = [...perRepo.entries()].sort((a, b) => b[1] - a[1]);
  for (const [rid, n] of repos) {
    const mark = args.repoId && rid === args.repoId ? '  <-- target' : '';
    console.log(`  ${rid}: ${n}${mark}`);
  }
  if (args.repoId && !perRepo.has(args.repoId)) {
    problems++;
    console.log(`  x expected repo '${args.repoId}' has 0 memories`);
  }

  console.log(`\n${problems === 0 ? 'PASS - clean' : `FAIL - ${problems} issue(s)`}`);
  process.exit(problems === 0 ? 0 : 1);
}

main();
