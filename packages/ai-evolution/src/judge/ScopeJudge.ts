import type { CandidateMemory } from '@i-evolve/core';
import type { MemoryScope } from '@i-evolve/shared';

export interface ScopeResult {
  scope: MemoryScope;
  downgraded: boolean;
  reason?: string;
}

/**
 * Decide final scope. Enforces that task_constraint never escapes to
 * global/domain, and that scopes requiring an identifier have one.
 */
export function decideScope(candidate: CandidateMemory): ScopeResult {
  const proposed = candidate.proposedScope;

  if (candidate.type === 'task_constraint' && (proposed === 'global' || proposed === 'domain' || proposed === 'project')) {
    return { scope: 'task', downgraded: true, reason: 'task_constraint downgraded to task scope' };
  }

  if (proposed === 'project' && !candidate.projectId) {
    return { scope: candidate.repoId ? 'repo' : 'task', downgraded: true, reason: 'project scope requires projectId; downgraded' };
  }

  if (proposed === 'repo' && !candidate.repoId) {
    return { scope: 'task', downgraded: true, reason: 'repo scope requires repoId; downgraded' };
  }

  if (proposed === 'domain' && !candidate.domain) {
    return { scope: candidate.projectId ? 'project' : 'task', downgraded: true, reason: 'domain scope requires domain; downgraded' };
  }

  return { scope: proposed, downgraded: false };
}
