export const MEMORY_STATUSES = [
  'candidate',
  'active',
  'rejected',
  'deprecated',
  'superseded',
] as const;

export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  candidate: ['active', 'rejected'],
  active: ['deprecated', 'superseded'],
  superseded: ['deprecated'],
};

export const DEFAULT_TTL_DAYS = 180;
export const MAX_CONFIDENCE = 1.0;
export const MIN_CONFIDENCE = 0.0;
