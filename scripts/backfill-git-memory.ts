#!/usr/bin/env -S pnpm tsx
/**
 * backfill-git-memory.ts
 *
 * Repo-level memory backfill pipeline for I-Evolve.
 *
 * Raw inputs are limited to: a git business repo, its commit history, and its
 * CHANGELOG. This script distills those into repo-scoped memories via the
 * existing AI EvolutionPipeline (extractor -> PolicyJudge -> audit -> write),
 * then optionally commits + pushes them to the shared memory git remote.
 *
 * Strategy: AI distillation only. Each "window" of git history (a release tag
 * range, or the trailing commits if there are no tags) is packaged as a
 * synthetic SessionSummary and run through EvolutionPipeline, exactly like a
 * live coding session would be — so dedup / scope-downgrade / TTL / audit all
 * apply for free.
 *
 * Idempotency: incremental runs are bounded by a watermark sidecar
 * (~/.i-evolve/shared/.backfill/<repoId>.json) recording the last processed
 * sha; `--since` defaults to it, so already-processed commits are never re-read.
 * Each memory also carries a compact window-range marker plus any model-cited
 * shas in source_refs, and shas already present in existing repo-scoped
 * memories are skipped as a secondary guard. The sidecar is not a .md file, so
 * it is ignored by the push validator.
 *
 * Usage (run inside the business repo):
 *   pnpm tsx scripts/backfill-git-memory.ts [options]
 *
 * Options:
 *   --repo <path>        Business repo path (default: cwd)
 *   --since <sha|tag>    Only process commits after this ref (default: watermark, else full history)
 *   --max-windows <n>    Cap number of windows processed this run (default: 20)
 *   --domain <name>      Override detected domain
 *   --dry-run            Extract + judge, print candidates, write nothing
 *   --push               After writing, validate + commit + push to memory remote
 *   --message <msg>      Commit message for --push (default auto)
 *
 * Distillation provider (pick one):
 *   IEVOLVE_CLAUDE_CLI=1            distill via the local `claude -p` CLI (preferred)
 *     IEVOLVE_CLAUDE_MODEL=<alias> model alias for the CLI (default: sonnet)
 *   IEVOLVE_AI_BASE_URL/_API_KEY/_MODEL   OpenAI-compatible endpoint
 * If neither is set, falls back to a MockAiProvider that yields zero candidates
 * (so a run without a provider is a safe no-op rather than garbage).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository, detectRepoIdentity } from '@i-evolve/storage';
import { GitMemorySync } from '@i-evolve/git-sync';
import {
  EvolutionPipeline,
  MockAiProvider,
  OpenAiCompatibleProvider,
  ClaudeCliProvider,
  CodexCliProvider,
  getProvider as getSharedProvider,
  type AiProvider,
  type AiCompleteInput,
  type AiCompleteOutput,
  type CreateMemoryFromDecisionInput,
} from '@i-evolve/ai-evolution';
import type { AuditAction, SessionSummary } from '@i-evolve/core';

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

interface Args {
  repo: string;
  since?: string;
  maxWindows: number;
  domain?: string;
  dryRun: boolean;
  push: boolean;
  message?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { repo: process.cwd(), maxWindows: 20, dryRun: false, push: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case '--repo': a.repo = next(); break;
      case '--since': a.since = next(); break;
      case '--max-windows': a.maxWindows = Number(next()); break;
      case '--domain': a.domain = next(); break;
      case '--message': a.message = next(); break;
      case '--dry-run': a.dryRun = true; break;
      case '--push': a.push = true; break;
      default:
        console.error(`Unknown argument: ${t}`);
        process.exit(2);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// git extraction (business repo)
// ---------------------------------------------------------------------------

interface Commit {
  sha: string;
  date: string; // ISO-8601
  author: string;
  subject: string;
  body: string;
}

const FIELD_SEP = '\x1f'; // unit separator
const RECORD_SEP = '\x1e'; // record separator

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** All commits (newest first), optionally limited to the range after `since`. */
function readCommits(repo: string, since?: string): Commit[] {
  const range = since ? [`${since}..HEAD`] : [];
  const fmt = ['%H', '%cI', '%an', '%s', '%b'].join(FIELD_SEP) + RECORD_SEP;
  const out = git(repo, ['log', `--pretty=format:${fmt}`, ...range]);
  if (!out) return [];
  return out
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, date, author, subject, ...rest] = r.split(FIELD_SEP);
      return { sha, date, author, subject, body: (rest.join(FIELD_SEP) ?? '').trim() };
    });
}

/** Release tags reachable from HEAD, oldest first, with their commit sha. */
function readReleaseTags(repo: string): Array<{ tag: string; sha: string; date: string }> {
  let raw: string;
  try {
    raw = git(repo, [
      'for-each-ref',
      '--sort=creatordate',
      '--format=%(refname:short)' + FIELD_SEP + '%(objectname)' + FIELD_SEP + '%(creatordate:iso-strict)',
      'refs/tags',
    ]);
  } catch {
    return [];
  }
  if (!raw) return [];
  const tags: Array<{ tag: string; sha: string; date: string }> = [];
  for (const line of raw.split('\n')) {
    const [tag, sha, date] = line.split(FIELD_SEP);
    if (!tag || !sha) continue;
    // dereference annotated tag to its commit
    let commitSha = sha;
    try {
      commitSha = git(repo, ['rev-list', '-n', '1', tag]);
    } catch {
      /* keep objectname */
    }
    tags.push({ tag, sha: commitSha, date: date ?? '' });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// CHANGELOG parsing
// ---------------------------------------------------------------------------

interface ChangelogSection {
  version: string; // e.g. "1.2.0" or "Unreleased"
  entries: { added: string[]; changed: string[]; fixed: string[]; breaking: string[]; other: string[] };
}

function readChangelog(repo: string): ChangelogSection[] {
  const candidates = ['CHANGELOG.md', 'CHANGELOG', 'CHANGELOG.MD', 'changelog.md'];
  const file = candidates.map((c) => join(repo, c)).find(existsSync);
  if (!file) return [];
  const raw = readFileSync(file, 'utf-8');

  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let bucket: keyof ChangelogSection['entries'] = 'other';

  for (const line of raw.split('\n')) {
    const ver = line.match(/^##\s+\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*|Unreleased)\]?/i);
    if (ver) {
      current = { version: ver[1], entries: { added: [], changed: [], fixed: [], breaking: [], other: [] } };
      sections.push(current);
      bucket = 'other';
      continue;
    }
    if (!current) continue;
    const head = line.match(/^###\s+(.+)/);
    if (head) {
      const h = head[1].toLowerCase();
      bucket = h.includes('break') ? 'breaking'
        : h.includes('add') ? 'added'
        : h.includes('chang') ? 'changed'
        : h.includes('fix') ? 'fixed'
        : 'other';
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)/);
    if (item && current) {
      const text = item[1].trim();
      if (/break/i.test(text)) current.entries.breaking.push(text);
      else current.entries[bucket].push(text);
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// windowing: group commits into release windows (or trailing chunks)
// ---------------------------------------------------------------------------

interface Window {
  key: string; // stable id fragment, e.g. "v1.2.0" or "recent-0"
  label: string; // human title hint
  endedAt: string;
  commits: Commit[];
  changelog?: ChangelogSection;
}

const CHUNK = 40; // commits per window when no tags exist

/**
 * Prefer release-tag boundaries: window N = commits in (tag[N-1], tag[N]].
 * Fall back to fixed-size trailing chunks when the repo has no tags.
 */
function buildWindows(repo: string, commits: Commit[], changelog: ChangelogSection[]): Window[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const order = new Map(commits.map((c, i) => [c.sha, i])); // 0 = newest
  const tags = readReleaseTags(repo).filter((t) => bySha.has(t.sha)); // only tags inside our range

  const clMap = new Map<string, ChangelogSection>();
  for (const s of changelog) clMap.set(normalizeVersion(s.version), s);

  if (tags.length === 0) {
    const windows: Window[] = [];
    for (let i = 0; i < commits.length; i += CHUNK) {
      const slice = commits.slice(i, i + CHUNK);
      windows.push({
        key: `recent-${slice[0].sha.slice(0, 8)}`,
        label: `commits ${slice[slice.length - 1].sha.slice(0, 7)}..${slice[0].sha.slice(0, 7)}`,
        endedAt: slice[0].date,
        commits: slice,
      });
    }
    return windows;
  }

  // tags sorted oldest->newest by their position in `commits` (newest = idx 0)
  const sortedTags = [...tags].sort((a, b) => (order.get(b.sha)! - order.get(a.sha)!));
  const windows: Window[] = [];

  // newest-first walk: each tag closes a window of commits from just-after the
  // previous (newer) tag down to this tag inclusive.
  const tagsNewestFirst = [...sortedTags].reverse();
  let prevNewerIdx = -1;
  for (const t of tagsNewestFirst) {
    const tagIdx = order.get(t.sha)!;
    const slice = commits.filter((c) => {
      const idx = order.get(c.sha)!;
      return idx > prevNewerIdx && idx <= tagIdx;
    });
    prevNewerIdx = tagIdx;
    if (slice.length === 0) continue;
    windows.push({
      key: t.tag,
      label: `release ${t.tag}`,
      endedAt: t.date || slice[0].date,
      commits: slice,
      changelog: clMap.get(normalizeVersion(t.tag)),
    });
  }

  // commits newer than the newest tag (unreleased) become their own window
  const newestTagIdx = order.get(sortedTags[sortedTags.length - 1].sha)!;
  const unreleased = commits.filter((c) => order.get(c.sha)! < newestTagIdx);
  if (unreleased.length > 0) {
    windows.unshift({
      key: `unreleased-${unreleased[0].sha.slice(0, 8)}`,
      label: 'unreleased changes since latest tag',
      endedAt: unreleased[0].date,
      commits: unreleased,
      changelog: clMap.get('unreleased'),
    });
  }

  return windows;
}

function normalizeVersion(v: string): string {
  return v.trim().toLowerCase().replace(/^v/, '');
}

// ---------------------------------------------------------------------------
// synthetic SessionSummary: map a window's git+changelog signals onto the
// fields the AI extractor actually reads (summary, decisions, constraints,
// mistakes, userCorrections, candidateMemoryHints, repoId).
// ---------------------------------------------------------------------------

const FIX_RE = /^(fix|revert|hotfix|bugfix)(\(|:|\/|\b)/i;
const FEAT_RE = /^(feat|feature)(\(|:|\/|\b)/i;
const SCOPE_RE = /^[a-z]+\(([^)]+)\)/i;

function buildSessionSummary(repoId: string, win: Window, ttlYears: number): SessionSummary {
  const fixes = win.commits.filter((c) => FIX_RE.test(c.subject)).map((c) => `${c.subject} [${c.sha.slice(0, 7)}]`);
  const feats = win.commits.filter((c) => FEAT_RE.test(c.subject)).map((c) => c.subject);

  // subsystem map from conventional-commit scopes
  const scopeCounts = new Map<string, number>();
  for (const c of win.commits) {
    const m = c.subject.match(SCOPE_RE);
    if (m) scopeCounts.set(m[1], (scopeCounts.get(m[1]) ?? 0) + 1);
  }
  const scopeFacts = [...scopeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `subsystem "${s}" saw ${n} change(s) in ${win.label}`);

  const cl = win.changelog?.entries;
  const decisions = [
    ...(cl?.breaking ?? []).map((e) => `BREAKING: ${e}`),
    ...(cl?.changed ?? []),
    ...feats.slice(0, 12),
  ];
  const mistakes = [...(cl?.fixed ?? []), ...fixes.slice(0, 20)];

  const summaryText =
    `Backfill window: ${win.label} for repo ${repoId}. ` +
    `${win.commits.length} commit(s). ` +
    `${(cl?.added?.length ?? 0)} added / ${(cl?.changed?.length ?? 0)} changed / ` +
    `${mistakes.length} fix-or-bug entries / ${(cl?.breaking?.length ?? 0)} breaking.`;

  const endedAt = win.endedAt || new Date().toISOString();
  const expiresAt = new Date(Date.parse(endedAt) + ttlYears * 365 * 24 * 3600 * 1000).toISOString();

  return {
    id: `backfill.${repoId.replace(/\//g, '-')}.${win.key}`,
    sessionId: `backfill-${repoId.replace(/\//g, '-')}-${win.key}`,
    repoId,
    endedAt,
    summary: summaryText,
    decisions,
    constraints: [],
    mistakes,
    userCorrections: [],
    filesTouched: [],
    candidateMemoryHints: [
      ...scopeFacts,
      ...(cl?.added ?? []).slice(0, 12).map((e) => `Added: ${e}`),
    ],
    candidateInstinctHints: [],
    sensitivity: 'internal',
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// infra: provider, repo, audit, watermark, sha dedup
// ---------------------------------------------------------------------------

function getProvider(): { provider: AiProvider; live: boolean } {
  try {
    return { provider: getSharedProvider(), live: true };
  } catch {
    const mock = new MockAiProvider();
    mock.setDefault('[]');
    return { provider: mock, live: false };
  }
}

function getRepo(): MarkdownMemoryRepository {
  return new MarkdownMemoryRepository({
    memoryDir: paths.shared.memory,
    dbPath: join(paths.base, 'shared', 'index.db'),
  });
}

function appendAudit(action: AuditAction): void {
  const dir = paths.audit.dir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const month = new Date(action.createdAt).toISOString().slice(0, 7);
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(action) + '\n', 'utf-8');
}

/** Shas already captured by any existing repo-scoped memory's source_refs. */
function knownShas(repo: MarkdownMemoryRepository, repoId: string): Set<string> {
  const set = new Set<string>();
  const shaRe = /\b[0-9a-f]{7,40}\b/g;
  for (const m of repo.list({ scope: 'repo', repoId })) {
    for (const ref of m.sourceRefs ?? []) {
      for (const match of ref.matchAll(shaRe)) set.add(match[0]);
    }
    if (m.sourceGitCommit) set.add(m.sourceGitCommit);
  }
  return set;
}

interface Watermark {
  repoId: string;
  lastSha: string;
  updatedAt: string;
}

function watermarkPath(repoId: string): string {
  const dir = join(paths.shared.dir, '.backfill');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${repoId.replace(/\//g, '-')}.json`);
}

function readWatermark(repoId: string): Watermark | null {
  const p = watermarkPath(repoId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Watermark;
  } catch {
    return null;
  }
}

function writeWatermark(repoId: string, lastSha: string): void {
  const wm: Watermark = { repoId, lastSha, updatedAt: new Date().toISOString() };
  writeFileSync(watermarkPath(repoId), JSON.stringify(wm, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(join(args.repo, '.git'))) {
    console.error(`Not a git repo: ${args.repo}`);
    process.exit(1);
  }

  const identity = detectRepoIdentity({ cwd: args.repo, manualDomain: args.domain });
  const repoId = identity.repoId;
  console.log(`repo:        ${repoId}`);
  console.log(`domain:      ${identity.domain ?? '(none)'}`);

  const since = args.since ?? readWatermark(repoId)?.lastSha;
  if (since) console.log(`since:       ${since}`);

  const { provider, live } = getProvider();
  if (!live) {
    console.warn('\n⚠  No distillation provider configured — using MockAiProvider (yields 0 candidates).');
    console.warn('   Set IEVOLVE_CLAUDE_CLI=1 to distill via the local `claude -p` CLI,');
    console.warn('   or set IEVOLVE_AI_BASE_URL / _API_KEY / _MODEL for an OpenAI-compatible endpoint.\n');
  }

  let commits: Commit[];
  try {
    commits = readCommits(args.repo, since);
  } catch (err) {
    console.error(`git log failed (bad --since ref?): ${(err as Error).message}`);
    process.exit(1);
  }
  if (commits.length === 0) {
    console.log('No new commits to process. Up to date.');
    return;
  }
  console.log(`commits:     ${commits.length}`);

  const changelog = readChangelog(args.repo);
  console.log(`changelog:   ${changelog.length} version section(s)`);

  const repo = getRepo();
  const seenShas = knownShas(repo, repoId);

  // Drop commits already captured; keep windows that still have fresh commits.
  const allWindows = buildWindows(args.repo, commits, changelog);
  const windows = allWindows
    .map((w) => ({ ...w, commits: w.commits.filter((c) => !seenShas.has(c.sha)) }))
    .filter((w) => w.commits.length > 0)
    .slice(0, args.maxWindows);

  console.log(`windows:     ${windows.length} to process (of ${allWindows.length} total)\n`);
  if (windows.length === 0) {
    console.log('All commits already captured in existing memories. Nothing to do.');
    repo.close();
    return;
  }

  // Compact provenance marker for the window currently being processed, e.g.
  // "platform/bili-gateway@728ecfa..1e14647". Merged into every memory's
  // source_refs so provenance does NOT depend on the model echoing shas back,
  // WITHOUT dumping the whole window (5000+ shas) into each file. Incremental
  // dedup is owned by the watermark sidecar (`since` defaults to it), so the
  // per-memory list only needs the model-cited shas plus this range marker.
  let currentWindowMarker = '';

  const pipeline = new EvolutionPipeline({
    provider,
    writeMemory: (input: CreateMemoryFromDecisionInput) =>
      repo.create({
        id: input.id,
        type: input.type,
        scope: input.scope,
        title: input.title,
        content: input.content,
        status: 'active',
        visibility: input.visibility,
        confidence: input.confidence,
        ttlDays: input.ttlDays,
        expiresAt: input.expiresAt,
        tags: [...new Set([...input.tags, 'backfill', 'git-history'])],
        sourceRefs: [...new Set([...input.sourceRefs, currentWindowMarker])],
        repoId: input.repoId ?? repoId,
        domain: input.domain ?? identity.domain,
      } as any),
    appendAudit,
  });

  let written = 0;
  let candidates = 0;

  for (const win of windows) {
    // newest-first: [0] newest, [last] oldest → "repoId@<oldest>..<newest>"
    const newest = win.commits[0].sha.slice(0, 7);
    const oldest = win.commits[win.commits.length - 1].sha.slice(0, 7);
    currentWindowMarker = `${repoId}@${oldest}..${newest}`;
    const summary = buildSessionSummary(repoId, win, 1);
    // Also surface the shas to the model as evidence (abbreviated for prompt size).
    summary.candidateMemoryHints = [
      ...summary.candidateMemoryHints,
      `source commits: ${win.commits.map((c) => c.sha.slice(0, 7)).join(', ')}`,
    ];

    process.stdout.write(`▶ ${win.label} (${win.commits.length} commits) … `);
    let results;
    try {
      results = await pipeline.run(summary, { dryRun: args.dryRun });
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      continue;
    }
    candidates += results.length;
    const w = results.filter((r) => r.written).length;
    written += w;
    console.log(`${results.length} candidate(s), ${args.dryRun ? '0 written (dry-run)' : `${w} written`}`);
    for (const r of results) {
      const tag = r.written ? 'WRITE' : r.decision.decision.toUpperCase();
      console.log(`    [${tag}] ${r.candidate.title} — ${r.decision.reason}`);
    }
  }

  repo.close();

  console.log(`\nSummary: ${candidates} candidate(s), ${written} written across ${windows.length} window(s).`);

  if (args.dryRun) {
    console.log('Dry-run: no memories written, watermark unchanged, nothing pushed.');
    return;
  }

  // Advance watermark to the newest commit we saw this run (idempotent re-runs).
  writeWatermark(repoId, commits[0].sha);
  console.log(`watermark → ${commits[0].sha.slice(0, 12)}`);

  if (!args.push) {
    console.log('\nNot pushing (omit --push). To publish manually:');
    console.log('  i-evolve memory remote validate');
    console.log('  i-evolve memory remote commit --message "..."');
    console.log('  i-evolve memory remote push');
    return;
  }

  await publish(repoId, windows.length, written, args.message);
}

async function publish(repoId: string, windowCount: number, written: number, message?: string): Promise<void> {
  const sync = new GitMemorySync(paths.shared.memory);
  if (!sync.isInitialized()) {
    console.error('\nMemory remote not initialized. Run: i-evolve memory remote init <url>');
    process.exit(1);
  }

  const report = sync.validate();
  if (!report.ok) {
    console.error(`\nValidation failed (${report.issues.length} issue(s)); not pushing:`);
    for (const i of report.issues) console.error(`  ${i.file}: ${i.problem}`);
    process.exit(1);
  }
  console.log(`\nvalidate: OK (${report.checkedFiles} file(s))`);

  const msg = message ?? `backfill(${repoId}): ${written} memories from ${windowCount} window(s)`;
  const committed = await sync.commit({ message: msg });
  console.log(committed.message + (committed.commit ? ` (${committed.commit.slice(0, 8)})` : ''));

  const pushed = await sync.push({ appendAudit });
  console.log(pushed.message);
  if (!pushed.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});



