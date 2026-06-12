import type { ObservationSensitivity } from '@i-evolve/shared';

/**
 * Decide whether a memory with given sensitivity may be shared to remote.
 * Per MVP3 spec: sensitive memory must not enter shared remote.
 */
export function canShareRemote(sensitivity: ObservationSensitivity): boolean {
  return sensitivity !== 'sensitive';
}
