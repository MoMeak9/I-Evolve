import type { Observation } from '@i-evolve/core';
import type { AuditAction } from '@i-evolve/core';
import type { MemoryItem } from '@i-evolve/core';

export type DaemonRequest =
  | { type: 'ping' }
  | { type: 'health' }
  | { type: 'observe'; payload: Observation }
  | { type: 'audit.append'; payload: AuditAction }
  | { type: 'session.start'; payload: SessionStartInput }
  | { type: 'session.finalize'; payload: SessionFinalizeInput }
  | { type: 'memory.recall'; payload: MemoryRecallInput }
  | { type: 'memory.search'; payload: MemorySearchInput }
  | { type: 'memory.remember'; payload: MemoryRememberInput }
  | { type: 'memory.forget'; payload: MemoryForgetInput }
  | { type: 'memory.audit'; payload: MemoryAuditInput }
  | { type: 'memory.explain'; payload: MemoryExplainInput }
  | { type: 'memory.sync'; payload: MemorySyncInput }
  | { type: 'dashboard.summary'; payload?: DashboardSummaryInput }
  | { type: 'dashboard.memory'; payload: MemoryExplainInput }
  | { type: 'dashboard.rollback'; payload: DashboardRollbackInput }
  | { type: 'index.rebuild'; payload?: Record<string, never> }
  | { type: 'git.status'; payload?: Record<string, never> };

export interface SessionStartInput {
  sessionId: string;
  repoId?: string;
  cwd: string;
}

export interface SessionFinalizeInput {
  sessionId: string;
}

export interface MemoryRecallInput {
  query?: string;
  cwd: string;
  maxTokens?: number;
  repoId?: string;
  domain?: string;
}

export interface MemorySearchInput {
  query: string;
}

export interface MemoryRememberInput {
  content: string;
  cwd?: string;
  repoId?: string;
  domain?: string;
  title?: string;
  type?: MemoryItem['type'];
  scope?: MemoryItem['scope'];
  tags?: string[];
}

export interface MemoryForgetInput {
  memoryId: string;
  mode?: 'soft' | 'tombstone';
}

export interface MemoryAuditInput {
  memoryId?: string;
}

export interface MemoryExplainInput {
  memoryId: string;
}

export interface MemorySyncInput {
  action: 'pull' | 'push' | 'status';
}

export interface DashboardSummaryInput {
  query?: string;
}

export interface DashboardRollbackInput {
  toCommit: string;
  mode?: 'checkout' | 'revert';
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
