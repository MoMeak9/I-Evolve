import type { MemoryStatus } from '@i-evolve/shared';
import { VALID_STATUS_TRANSITIONS } from '@i-evolve/shared';

export function canTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function validateStatusTransition(
  from: MemoryStatus,
  to: MemoryStatus,
): { valid: boolean; reason?: string } {
  if (!canTransition(from, to)) {
    return {
      valid: false,
      reason: `Cannot transition from '${from}' to '${to}'. Allowed: ${VALID_STATUS_TRANSITIONS[from]?.join(', ') ?? 'none'}`,
    };
  }
  return { valid: true };
}
