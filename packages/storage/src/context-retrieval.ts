import type { MemoryItem } from '@i-evolve/core';
import type { MarkdownMemoryRepository } from './memory-repository.js';

export interface RetrievalContext {
  repoId?: string;
  projectId?: string;
  domain?: string;
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

/**
 * Retrieve memories for context injection.
 * Only active, non-expired memories are eligible. Scope must match context.
 */
export function retrieveContext(
  repo: MarkdownMemoryRepository,
  ctx: RetrievalContext,
  limits: TopKLimits = DEFAULT_LIMITS,
): RetrievedContext {
  const now = ctx.now ? Date.parse(ctx.now) : Date.now();
  const all = repo.list({ status: 'active' }).filter((m) => !isExpired(m, now));

  const inScope = (m: MemoryItem): boolean => {
    switch (m.scope) {
      case 'repo': return !!ctx.repoId && m.repoId === ctx.repoId;
      case 'project': return !!ctx.projectId && m.projectId === ctx.projectId;
      case 'domain': return !!ctx.domain && m.domain === ctx.domain;
      case 'user': return true;
      case 'global': return true;
      case 'task': return false;
      default: return false;
    }
  };

  const eligible = all.filter(inScope);
  const byConfidence = (a: MemoryItem, b: MemoryItem) => b.confidence - a.confidence;

  const isWarning = (m: MemoryItem) => m.type === 'pitfall';

  return {
    repo: eligible.filter((m) => m.scope === 'repo' && !isWarning(m)).sort(byConfidence).slice(0, limits.repo),
    project: eligible.filter((m) => m.scope === 'project' && !isWarning(m)).sort(byConfidence).slice(0, limits.project),
    domain: eligible.filter((m) => m.scope === 'domain' && !isWarning(m)).sort(byConfidence).slice(0, limits.domain),
    user: eligible.filter((m) => m.scope === 'user' && m.type === 'user_preference').sort(byConfidence).slice(0, limits.user),
    global: eligible.filter((m) => m.scope === 'global' && m.type === 'workflow_rule').sort(byConfidence).slice(0, limits.global),
    warnings: eligible.filter(isWarning).sort(byConfidence).slice(0, limits.warnings),
  };
}

function isExpired(m: MemoryItem, now: number): boolean {
  if (!m.expiresAt) return false;
  return Date.parse(m.expiresAt) <= now;
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
