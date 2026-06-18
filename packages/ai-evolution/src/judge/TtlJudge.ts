import type { MemoryType, MemoryScope } from '@i-evolve/shared';

/**
 * TTL decision table from MVP3 spec section 6.
 * Returns ttl in days, or null for indefinite (e.g. stable user preference).
 */
export function decideTtl(type: MemoryType, scope: MemoryScope): number | null {
  if (type === 'task_constraint') return 30;

  switch (scope) {
    case 'task': return 30;
    case 'repo': return 180;
    case 'domain': return 180;
    case 'global': return 180;
    default: return 180;
  }
}
