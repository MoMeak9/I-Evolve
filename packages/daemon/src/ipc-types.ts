import type { Observation } from '@i-evolve/core';
import type { AuditAction } from '@i-evolve/core';

export type DaemonRequest =
  | { type: 'ping' }
  | { type: 'health' }
  | { type: 'observe'; payload: Observation }
  | { type: 'audit.append'; payload: AuditAction }
  | { type: 'session.start'; payload: SessionStartInput }
  | { type: 'session.finalize'; payload: SessionFinalizeInput };

export interface SessionStartInput {
  sessionId: string;
  repoId?: string;
  projectId?: string;
  cwd: string;
}

export interface SessionFinalizeInput {
  sessionId: string;
}

export interface DaemonResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
