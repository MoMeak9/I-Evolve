#!/usr/bin/env -S pnpm tsx
/**
 * inject-pr-candidates.ts
 *
 * Second-stage of the diff-driven backfill. Subagents read each PR's diff and
 * emit structured candidate memories (the distillation step). This script takes
 * those candidates as a JSON file and runs them through the REAL EvolutionPipeline
 * (PolicyJudge admission -> dedup -> audit -> content_hash -> write), so injected
 * candidates land exactly like extractor output — no package changes, single
 * writer process so dedup is correct.
 *
 * Candidate JSON shape (array): each item is what the LLM extractor would emit:
 *   { title, type, proposedScope, content, sourceRefs, confidence, evidence? }
 *   - type        ∈ repo_fact | task_constraint | decision | pitfall | workflow_rule
 *   - proposedScope ∈ global | domain | repo | task
 *   - sourceRefs  = PR merge sha(s) + touched files (compact provenance)
 *
 * Usage:
 *   pnpm tsx --tsconfig scripts/tsconfig.json scripts/inject-pr-candidates.ts \
 *     --repo /path/to/business-repo \
 *     --candidates /tmp/pr_candidates.json \
 *     [--dry-run]
 *
 * Writes to ~/.i-evolve (or $IEVOLVE_BASE_PATH). Never commits or pushes.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository, detectRepoIdentity } from '@i-evolve/storage';
import {
  EvolutionPipeline,
  MockAiProvider,
  type CreateMemoryFromDecisionInput,
} from '@i-evolve/ai-evolution';
import type { AuditAction, SessionSummary, CandidateMemory } from '@i-evolve/core';
import type { MemoryScope } from '@i-evolve/shared';

interface Args {
  repo: string;
  candidates: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { repo: process.cwd(), candidates: '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--repo': a.repo = next(); break;
      case '--candidates': a.candidates = next(); break;
      case '--dry-run': a.dryRun = true; break;
    }
  }
  return a;
}

function getRepo(): MarkdownMemoryRepository {
  const memoryDir = paths.shared.memory;
  const dbPath = join(paths.base, 'shared', 'index.db');
  for (const d of [memoryDir, join(paths.base, 'shared')]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return new MarkdownMemoryRepository({ memoryDir, dbPath });
}

function appendAudit(action: AuditAction): void {
  const dir = paths.audit.dir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const month = new Date(action.createdAt).toISOString().slice(0, 7);
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(action) + '\n', 'utf-8');
}

const TTL_DAYS = 180;

/**
 * Stable id for a candidate. Mirrors the packaged defaultId, but guards two
 * collision modes the packaged version silently loses data on:
 *   1. Non-ASCII title (e.g. pure Chinese) -> empty ASCII slug -> every such
 *      candidate becomes `repo.<repoId>.` and overwrites onto one file.
 *   2. Distinct titles sharing the same ASCII slug (e.g. two titles whose only
 *      latin run is "ACL") -> same id -> the later one overwrites the earlier.
 * For (1) we fall back to a sha+title-hash slug; for (2) we disambiguate any
 * id already seen this run by appending that same sha+hash suffix.
 */
const seenIds = new Set<string>();
function idForCandidate(c: CandidateMemory, scope: MemoryScope): string {
  const ns = (c.repoId ?? 'unknown').replace(/\//g, '-');
  const sha = (c.sourceRefs ?? []).find((r) => /^[0-9a-f]{7,40}$/.test(r))?.slice(0, 7) ?? 'x';
  let h = 0;
  for (const ch of c.title ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const suffix = `${sha}-${h.toString(36)}`;
  let slug = (c.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) slug = suffix;
  let id = `${scope}.${ns}.${slug}`;
  if (seenIds.has(id)) id = `${scope}.${ns}.${slug}-${suffix}`;
  seenIds.add(id);
  return id;
}


async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.candidates || !existsSync(args.candidates)) {
    console.error(`--candidates <file> required and must exist (got: ${args.candidates})`);
    process.exit(1);
  }
  if (!existsSync(join(args.repo, '.git'))) {
    console.error(`Not a git repo: ${args.repo}`);
    process.exit(1);
  }

  const identity = detectRepoIdentity({ cwd: args.repo, manualDomain: undefined });
  const repoId = identity.repoId;
  console.log(`repo:        ${repoId}`);
  console.log(`domain:      ${identity.domain ?? '(none)'}`);

  const candidates = JSON.parse(readFileSync(args.candidates, 'utf-8')) as unknown[];
  if (!Array.isArray(candidates)) {
    console.error('Candidates file must contain a JSON array.');
    process.exit(1);
  }
  console.log(`candidates:  ${candidates.length} from ${args.candidates}\n`);

  // The subagents ARE the distiller; feed their candidate array straight to a
  // MockAiProvider so the real extractor->judge->write path runs unchanged.
  const provider = new MockAiProvider();
  provider.setDefault(JSON.stringify(candidates));

  const repo = getRepo();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + TTL_DAYS * 24 * 3600 * 1000).toISOString();

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
        ttlDays: input.ttlDays ?? TTL_DAYS,
        expiresAt: input.expiresAt ?? expiresAt,
        tags: [...new Set([...input.tags, 'backfill', 'pr-diff'])],
        sourceRefs: input.sourceRefs,
        repoId: input.repoId ?? repoId,
        domain: input.domain ?? identity.domain,
      } as any),
    appendAudit,
    idForCandidate,
  });

  // Minimal synthetic summary: repoId drives candidate.repoId fallback in
  // normalize(); the rest is unused because the provider ignores the prompt.
  const summary: SessionSummary = {
    id: `pr-diff.${repoId.replace(/\//g, '-')}`,
    sessionId: `pr-diff-${repoId.replace(/\//g, '-')}`,
    repoId,
    endedAt: now,
    summary: `PR-diff distilled candidates for ${repoId}.`,
    decisions: [],
    constraints: [],
    mistakes: [],
    userCorrections: [],
    filesTouched: [],
    candidateMemoryHints: [],
    candidateInstinctHints: [],
    sensitivity: 'internal',
    expiresAt,
  };

  const results = await pipeline.run(summary, { dryRun: args.dryRun });
  const written = results.filter((r) => r.written).length;
  console.log(`${results.length} candidate(s), ${args.dryRun ? '0 written (dry-run)' : `${written} written`}\n`);
  for (const r of results) {
    const tag = r.written ? 'WRITE' : r.decision.decision.toUpperCase();
    console.log(`  [${tag}] ${r.candidate.title} — ${r.decision.reason}`);
  }

  repo.close();
  if (args.dryRun) console.log('\nDry-run: nothing written.');
  else console.log(`\nWrote ${written} memories to ${paths.shared.memory}. Not committed, not pushed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
