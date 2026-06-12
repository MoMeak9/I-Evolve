import type { MemoryScope } from '@i-evolve/shared';

const SCOPE_HIERARCHY: MemoryScope[] = ['task', 'repo', 'project', 'domain', 'user', 'global'];

export function scopeLevel(scope: MemoryScope): number {
  return SCOPE_HIERARCHY.indexOf(scope);
}

export function isScopeDowngrade(from: MemoryScope, to: MemoryScope): boolean {
  return scopeLevel(to) < scopeLevel(from);
}

export function validateScopeRequirements(
  scope: MemoryScope,
  data: { repoId?: string; projectId?: string; domain?: string },
): { valid: boolean; missing?: string[] } {
  const missing: string[] = [];
  if (scope === 'repo' && !data.repoId) missing.push('repoId');
  if (scope === 'project' && !data.projectId) missing.push('projectId');
  if (scope === 'domain' && !data.domain) missing.push('domain');
  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}
