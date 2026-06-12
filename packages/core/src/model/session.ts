export interface SessionSummary {
  id: string;
  sessionId: string;
  repoId?: string;
  projectId?: string;
  startedAt: string;
  endedAt: string;
  observationCount: number;
  memoriesProposed: string[];
  memoriesActivated: string[];
  summary: string;
}
