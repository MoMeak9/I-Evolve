import type { MemoryItem } from '@i-evolve/core';
import type { MarkdownMemoryRepository } from './memory-repository.js';
import type { SqliteIndex } from './sqlite-index.js';

export interface RetrievalDeps {
  index?: SqliteIndex;
  modelId?: string;
  /** 已 embed 的查询向量（L2 归一化）。由调用方在外层用 provider 算好传入。 */
  queryVector?: Float32Array;
}

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
  deps?: RetrievalDeps,
): RetrievedContext {
  return retrieveContextDebug(repo, ctx, limits, deps).retrieved;
}

export function retrieveContextDebug(
  repo: MarkdownMemoryRepository,
  ctx: RetrievalContext,
  limits: TopKLimits = DEFAULT_LIMITS,
  deps?: RetrievalDeps,
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
  const signals = buildSignalScores(repo, ctx, deps);
  stats.ftsMatches = signals.ftsMatches;

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

  const { selected, conflicts } = suppressConflicts(eligible, signals.scoreFor);
  stats.suppressedConflicts = conflicts.reduce((sum, c) => sum + c.suppressedMemoryIds.length, 0);

  const byScore = (a: MemoryItem, b: MemoryItem) => signals.scoreFor(b) - signals.scoreFor(a);

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

function suppressConflicts(memories: MemoryItem[], scoreFor: (m: MemoryItem) => number): { selected: MemoryItem[]; conflicts: ConflictReport[] } {
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
    const sorted = [...group].sort((a, b) => scoreFor(b) - scoreFor(a));
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

interface SignalIndex {
  ftsMatches: number;
  scoreFor: (m: MemoryItem) => number;
}

function buildSignalScores(repo: MarkdownMemoryRepository, ctx: RetrievalContext, deps?: RetrievalDeps): SignalIndex {
  // lexical: FTS rank -> [0,1] min-max
  const lexicalRaw = new Map<string, number>();
  if (ctx.query?.trim()) {
    try {
      for (const r of repo.search(ctx.query)) lexicalRaw.set(r.memory.id, -r.rank);
    } catch { /* ignore */ }
  }
  const lexical = minMaxNormalize(lexicalRaw);

  // dense: cosine via index.queryNearest -> 每 memory 取最高 chunk 分
  const dense = new Map<string, number>();
  if (deps?.index && deps.modelId && deps.queryVector) {
    for (const hit of deps.index.queryNearest(deps.queryVector, deps.modelId, 200)) {
      const prev = dense.get(hit.memory_id) ?? -Infinity;
      if (hit.score > prev) dense.set(hit.memory_id, hit.score);
    }
  }

  const now = ctx.now ? Date.parse(ctx.now) : Date.now();
  const scoreFor = (m: MemoryItem): number => {
    const d = clamp01(dense.get(m.id) ?? 0);
    const l = lexical.get(m.id) ?? 0;
    const intent = intentScore(m, ctx);
    const confidence = clamp01(m.confidence);
    const recency = recencyScore(m, now);
    const scope = scopeNorm(m.scope);
    return 0.45 * d + 0.20 * l + 0.15 * intent + 0.10 * confidence + 0.05 * recency + 0.05 * scope;
  };

  return { ftsMatches: lexicalRaw.size, scoreFor };
}

function minMaxNormalize(raw: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (raw.size === 0) return out;
  const vals = [...raw.values()];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  for (const [k, v] of raw) out.set(k, (v - min) / span);
  return out;
}

function intentScore(m: MemoryItem, ctx: RetrievalContext): number {
  let s = 0;
  if (ctx.domain && m.domain === ctx.domain) s += 0.5;
  const q = (ctx.query ?? '').toLowerCase();
  if (q && m.tags.some((t) => q.includes(t.toLowerCase()))) s += 0.5;
  return clamp01(s);
}

function recencyScore(m: MemoryItem, now: number): number {
  const updated = Date.parse(m.updatedAt);
  if (Number.isNaN(updated)) return 0;
  const days = Math.max(0, (now - updated) / 86_400_000);
  return Math.exp(-days / 30);
}

function scopeNorm(scope: MemoryItem['scope']): number {
  switch (scope) {
    case 'task': return 1;
    case 'repo': return 0.8;
    case 'domain': return 0.5;
    case 'global': return 0.3;
    default: return 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function isRecentSessionSummary(memory: MemoryItem): boolean {
  return memory.tags.includes('session-summary') || memory.sourceRefs.some((ref) => ref.startsWith('session-summary.'));
}

export function formatContextMarkdown(ctx: RetrievalContext, retrieved: RetrievedContext, maxTokens?: number): string {
  const lines: string[] = ['# I-Evolve Context', ''];

  const hasMemories =
    retrieved.repo.length + retrieved.domain.length + retrieved.global.length +
    retrieved.warnings.length + retrieved.recent.length > 0;

  // Frame the block as project-level constraints, not passive background. Without
  // an imperative lead-in this section reads as trivia and gets out-prioritized by
  // other SessionStart injections; state up front that it must be obeyed.
  if (hasMemories) {
    lines.push(
      '> 以下是本仓库沉淀的既有决策与已知陷阱,视为本仓库的项目级约束。' +
      '在本仓库进行分析、写码、改码前必须先读完本节:**Warnings 是必须规避的 bug 模式,High Priority Memories 是必须遵循的现有实现约定**。' +
      '与这些约束冲突的做法,除非用户明确要求,否则不得采用。',
      '',
    );
  }

  lines.push('## Current Repository');
  if (ctx.repoId) lines.push(`- repo_id: ${ctx.repoId}`);
  if (ctx.domain) lines.push(`- domain: ${ctx.domain}`);
  lines.push('');

  const renderGroup = (title: string, items: MemoryItem[], lead?: string) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    if (lead) lines.push(lead, '');
    for (const m of items) {
      lines.push(`- [${m.type} | ${m.scope} | conf=${m.confidence} | id=${m.id}]`);
      lines.push(`  ${m.content.split('\n')[0]}`);
    }
    lines.push('');
  };

  const highPriority = [...retrieved.repo, ...retrieved.domain];
  renderGroup('High Priority Memories', highPriority);
  renderGroup('Active Instincts', retrieved.global);
  renderGroup('Warnings', retrieved.warnings, '⚠️ 以下每条都是本仓库已踩过的坑,必须主动规避;改动相关代码时逐条核对。');
  renderGroup('Recent Session Summaries', retrieved.recent);

  const markdown = lines.join('\n').trimEnd() + '\n';
  if (!maxTokens || maxTokens <= 0) return markdown;
  const maxChars = Math.max(200, maxTokens * 4);
  return markdown.length > maxChars ? markdown.slice(0, maxChars).trimEnd() + '\n' : markdown;
}
