import type { MemoryItem } from '@i-evolve/core';
import type { MarkdownMemoryRepository } from './memory-repository.js';

export interface RetrievalContext {
  repoId?: string;
  domain?: string;
  packageNames?: string[];
  path?: string;
  query?: string;
  now?: string;
}

export interface TopKLimits {
  repo: number;
  domain: number;
  global: number;
  warnings: number;
  recent: number;
}

const DEFAULT_LIMITS: TopKLimits = {
  repo: 5,
  domain: 5,
  global: 5,
  warnings: 3,
  recent: 2,
};

export interface RetrievedContext {
  repo: MemoryItem[];
  domain: MemoryItem[];
  global: MemoryItem[];
  warnings: MemoryItem[];
  recent: MemoryItem[];
}

export interface ConflictReport {
  id: string;
  selectedMemoryId: string;
  suppressedMemoryIds: string[];
  reason: string;
  createdAt: string;
}

export interface RetrievalDebugStats {
  candidates: number;
  filteredExpired: number;
  filteredDeprecated: number;
  filteredScopeMismatch: number;
  injected: number;
  suppressedConflicts: number;
  ftsMatches: number;
}

export interface RetrievalDebugResult {
  retrieved: RetrievedContext;
  conflicts: ConflictReport[];
  stats: RetrievalDebugStats;
}

/**
 * Retrieve memories for context injection.
 * Only active, non-expired memories are eligible. Scope must match context.
 */
export function retrieveContext(
  repo: MarkdownMemoryRepository,
  ctx: RetrievalContext,
  limits: TopKLimits = DEFAULT_LIMITS,
): RetrievedContext {
  return retrieveContextDebug(repo, ctx, limits).retrieved;
}

export function retrieveContextDebug(
  repo: MarkdownMemoryRepository,
  ctx: RetrievalContext,
  limits: TopKLimits = DEFAULT_LIMITS,
): RetrievalDebugResult {
  const now = ctx.now ? Date.parse(ctx.now) : Date.now();
  const candidates = repo.list();
  const stats: RetrievalDebugStats = {
    candidates: candidates.length,
    filteredExpired: 0,
    filteredDeprecated: 0,
    filteredScopeMismatch: 0,
    injected: 0,
    suppressedConflicts: 0,
    ftsMatches: 0,
  };
  const ftsScores = buildFtsScores(repo, ctx.query);
  stats.ftsMatches = ftsScores.size;

  const eligible: MemoryItem[] = [];
  for (const memory of candidates) {
    if (memory.status !== 'active') {
      stats.filteredDeprecated++;
      continue;
    }
    if (isExpired(memory, now)) {
      stats.filteredExpired++;
      continue;
    }
    if (!matchesScope(memory, ctx)) {
      stats.filteredScopeMismatch++;
      continue;
    }
    eligible.push(memory);
  }

  const { selected, conflicts } = suppressConflicts(eligible, ftsScores);
  stats.suppressedConflicts = conflicts.reduce((sum, c) => sum + c.suppressedMemoryIds.length, 0);

  const byScore = (a: MemoryItem, b: MemoryItem) => scoreMemory(b, ftsScores) - scoreMemory(a, ftsScores);

  const isWarning = (m: MemoryItem) => m.type === 'pitfall';
  const isRecent = (m: MemoryItem) => isRecentSessionSummary(m);

  const retrieved = {
    repo: selected.filter((m) => m.scope === 'repo' && !isWarning(m) && !isRecent(m)).sort(byScore).slice(0, limits.repo),
    domain: selected.filter((m) => m.scope === 'domain' && !isWarning(m) && !isRecent(m)).sort(byScore).slice(0, limits.domain),
    global: selected.filter((m) => m.scope === 'global' && m.type === 'workflow_rule').sort(byScore).slice(0, limits.global),
    warnings: selected.filter(isWarning).sort(byScore).slice(0, limits.warnings),
    recent: selected.filter(isRecent).sort(byScore).slice(0, limits.recent),
  };
  stats.injected = Object.values(retrieved).reduce((sum, items) => sum + items.length, 0);

  return { retrieved, conflicts, stats };
}

function isExpired(m: MemoryItem, now: number): boolean {
  if (!m.expiresAt) return false;
  return Date.parse(m.expiresAt) <= now;
}

function matchesScope(memory: MemoryItem, ctx: RetrievalContext): boolean {
  if (matchesAppliesTo(memory, ctx)) return true;
  switch (memory.scope) {
    case 'repo': return !!ctx.repoId && memory.repoId === ctx.repoId;
    case 'domain': return !!ctx.domain && memory.domain === ctx.domain;
    case 'global': return true;
    case 'task': return false;
    default: return false;
  }
}

function matchesAppliesTo(memory: MemoryItem, ctx: RetrievalContext): boolean {
  const appliesTo = memory.appliesTo;
  if (!appliesTo) return false;
  const repoId = ctx.repoId;
  const packageNames = ctx.packageNames ?? [];
  const path = ctx.path;
  if (repoId && appliesTo.repoPatterns?.some((pattern) => globMatch(pattern, repoId))) return true;
  if (packageNames.length > 0 && appliesTo.packageNames?.some((pkg) => packageNames.includes(pkg))) return true;
  if (path && appliesTo.pathPatterns?.some((pattern) => globMatch(pattern, path))) return true;
  return false;
}

function suppressConflicts(memories: MemoryItem[], ftsScores: Map<string, number>): { selected: MemoryItem[]; conflicts: ConflictReport[] } {
  const byTopic = new Map<string, MemoryItem[]>();
  for (const memory of memories) {
    const topic = conflictTopic(memory);
    const group = byTopic.get(topic) ?? [];
    group.push(memory);
    byTopic.set(topic, group);
  }

  const selected: MemoryItem[] = [];
  const conflicts: ConflictReport[] = [];
  for (const [topic, group] of byTopic.entries()) {
    const sorted = [...group].sort((a, b) => scoreMemory(b, ftsScores) - scoreMemory(a, ftsScores));
    selected.push(sorted[0]);
    const suppressed = sorted.slice(1);
    if (suppressed.length > 0) {
      conflicts.push({
        id: `conflict.${topic}`,
        selectedMemoryId: sorted[0].id,
        suppressedMemoryIds: suppressed.map((m) => m.id),
        reason: 'Selected higher-priority memory for the same topic.',
        createdAt: new Date().toISOString(),
      });
    }
  }
  return { selected, conflicts };
}

function conflictTopic(memory: MemoryItem): string {
  const conflictTag = memory.tags.find((tag) => tag.startsWith('conflict:'));
  if (conflictTag) return conflictTag;
  if (memory.tags.length > 0 && memory.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') === memory.tags[0]) return memory.tags[0];
  return memory.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function scoreMemory(memory: MemoryItem, ftsScores: Map<string, number>): number {
  return scopePriority(memory.scope) * 100 + memory.confidence + (ftsScores.get(memory.id) ?? 0);
}

function scopePriority(scope: MemoryItem['scope']): number {
  switch (scope) {
    case 'repo': return 6;
    case 'domain': return 4;
    case 'global': return 2;
    case 'task': return 7;
    default: return 0;
  }
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function buildFtsScores(repo: MarkdownMemoryRepository, query: string | undefined): Map<string, number> {
  const scores = new Map<string, number>();
  if (!query?.trim()) return scores;
  try {
    for (const result of repo.search(query)) {
      scores.set(result.memory.id, Math.max(0, -result.rank) + 25);
    }
  } catch {
    return scores;
  }
  return scores;
}

function isRecentSessionSummary(memory: MemoryItem): boolean {
  return memory.tags.includes('session-summary') || memory.sourceRefs.some((ref) => ref.startsWith('session-summary.'));
}

export function formatContextMarkdown(ctx: RetrievalContext, retrieved: RetrievedContext, maxTokens?: number): string {
  const lines: string[] = ['# I-Evolve Context', ''];

  lines.push('## Current Repository');
  if (ctx.repoId) lines.push(`- repo_id: ${ctx.repoId}`);
  if (ctx.domain) lines.push(`- domain: ${ctx.domain}`);
  lines.push('');

  const renderGroup = (title: string, items: MemoryItem[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const m of items) {
      lines.push(`- [${m.type} | ${m.scope} | conf=${m.confidence} | id=${m.id}]`);
      lines.push(`  ${m.content.split('\n')[0]}`);
    }
    lines.push('');
  };

  const highPriority = [...retrieved.repo, ...retrieved.domain];
  renderGroup('High Priority Memories', highPriority);
  renderGroup('Active Instincts', retrieved.global);
  renderGroup('Warnings', retrieved.warnings);
  renderGroup('Recent Session Summaries', retrieved.recent);

  const markdown = lines.join('\n').trimEnd() + '\n';
  if (!maxTokens || maxTokens <= 0) return markdown;
  const maxChars = Math.max(200, maxTokens * 4);
  return markdown.length > maxChars ? markdown.slice(0, maxChars).trimEnd() + '\n' : markdown;
}
