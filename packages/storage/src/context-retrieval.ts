import type { MemoryItem } from '@i-evolve/core';
import type { MarkdownMemoryRepository } from './memory-repository.js';

export interface RetrievalContext {
  repoId?: string;
  projectId?: string;
  domain?: string;
  packageNames?: string[];
  path?: string;
  now?: string;
}

export interface TopKLimits {
  repo: number;
  project: number;
  domain: number;
  user: number;
  global: number;
  warnings: number;
}

const DEFAULT_LIMITS: TopKLimits = {
  repo: 5,
  project: 5,
  domain: 5,
  user: 3,
  global: 5,
  warnings: 3,
};

export interface RetrievedContext {
  repo: MemoryItem[];
  project: MemoryItem[];
  domain: MemoryItem[];
  user: MemoryItem[];
  global: MemoryItem[];
  warnings: MemoryItem[];
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
  };

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

  const { selected, conflicts } = suppressConflicts(eligible);
  stats.suppressedConflicts = conflicts.reduce((sum, c) => sum + c.suppressedMemoryIds.length, 0);

  const byScore = (a: MemoryItem, b: MemoryItem) => scoreMemory(b) - scoreMemory(a);

  const isWarning = (m: MemoryItem) => m.type === 'pitfall';

  const retrieved = {
    repo: selected.filter((m) => m.scope === 'repo' && !isWarning(m)).sort(byScore).slice(0, limits.repo),
    project: selected.filter((m) => m.scope === 'project' && !isWarning(m)).sort(byScore).slice(0, limits.project),
    domain: selected.filter((m) => m.scope === 'domain' && !isWarning(m)).sort(byScore).slice(0, limits.domain),
    user: selected.filter((m) => m.scope === 'user' && m.type === 'user_preference').sort(byScore).slice(0, limits.user),
    global: selected.filter((m) => m.scope === 'global' && m.type === 'workflow_rule').sort(byScore).slice(0, limits.global),
    warnings: selected.filter(isWarning).sort(byScore).slice(0, limits.warnings),
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
    case 'project': return !!ctx.projectId && memory.projectId === ctx.projectId;
    case 'domain': return !!ctx.domain && memory.domain === ctx.domain;
    case 'user': return true;
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

function suppressConflicts(memories: MemoryItem[]): { selected: MemoryItem[]; conflicts: ConflictReport[] } {
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
    const sorted = [...group].sort((a, b) => scoreMemory(b) - scoreMemory(a));
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
  if (memory.tags.length > 0) return memory.tags[0];
  return memory.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function scoreMemory(memory: MemoryItem): number {
  return scopePriority(memory.scope) * 100 + memory.confidence;
}

function scopePriority(scope: MemoryItem['scope']): number {
  switch (scope) {
    case 'repo': return 6;
    case 'project': return 5;
    case 'domain': return 4;
    case 'user': return 3;
    case 'global': return 2;
    case 'task': return 7;
    default: return 0;
  }
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function formatContextMarkdown(ctx: RetrievalContext, retrieved: RetrievedContext): string {
  const lines: string[] = ['# I-Evolve Context', ''];

  lines.push('## Current Repository');
  if (ctx.repoId) lines.push(`- repo_id: ${ctx.repoId}`);
  if (ctx.projectId) lines.push(`- project_id: ${ctx.projectId}`);
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

  const highPriority = [...retrieved.repo, ...retrieved.project, ...retrieved.domain, ...retrieved.user];
  renderGroup('High Priority Memories', highPriority);
  renderGroup('Active Instincts', retrieved.global);
  renderGroup('Warnings', retrieved.warnings);

  return lines.join('\n').trimEnd() + '\n';
}
