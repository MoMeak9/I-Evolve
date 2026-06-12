import type { ObservationSensitivity } from '@i-evolve/shared';

export interface SessionSummary {
  id: string;
  sessionId: string;
  repoId?: string;
  projectId?: string;
  startedAt?: string;
  endedAt: string;
  summary: string;
  decisions: string[];
  constraints: string[];
  mistakes: string[];
  userCorrections: string[];
  filesTouched: string[];
  candidateMemoryHints: string[];
  candidateInstinctHints: string[];
  sensitivity: ObservationSensitivity;
  expiresAt: string;
}
