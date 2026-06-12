import type { ObservationSource, ObservationPhase, ObservationStatus, ObservationSensitivity, RawRef } from '@i-evolve/shared';

export interface Observation {
  id: string;
  timestamp: string;
  sessionId: string;
  repoId?: string;
  projectId?: string;
  cwdHash?: string;
  source: ObservationSource;
  phase: ObservationPhase;
  tool?: string;
  summary: string;
  filesTouched?: string[];
  commands?: string[];
  riskFlags?: string[];
  status: ObservationStatus;
  sensitivity: ObservationSensitivity;
  rawRef?: RawRef;
}
