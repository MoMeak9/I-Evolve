import type { Observation } from '@i-evolve/core';

export interface ObservationRepository {
  append(event: Observation): Promise<void>;
  listBySession(sessionId: string): Promise<Observation[]>;
  listByProject(projectId: string, limit?: number): Promise<Observation[]>;
  archiveBefore(date: string): Promise<void>;
  purgeExpired(): Promise<void>;
}
