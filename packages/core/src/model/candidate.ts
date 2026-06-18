import type { MemoryType, MemoryScope, PolicyCheckResult } from '@i-evolve/shared';

export interface CandidateMemory {
  title: string;
  type: MemoryType;
  proposedScope: MemoryScope;
  content: string;
  evidence: string[];
  sourceRefs: string[];
  confidence: number;
  riskFlags: string[];
  repoId?: string;
  domain?: string;
}

export interface CandidateInstinct {
  title: string;
  proposedScope: MemoryScope;
  content: string;
  evidence: string[];
  sourceRefs: string[];
  confidence: number;
  riskFlags: string[];
}

export type PolicyDecisionType =
  | 'activate'
  | 'reject'
  | 'downgrade_scope'
  | 'needs_more_evidence';

export interface PolicyDecision {
  decision: PolicyDecisionType;
  finalScope?: MemoryScope;
  finalType?: MemoryType;
  confidence: number;
  ttlDays?: number | null;
  expiresAt?: string | null;
  reason: string;
  policyChecks: PolicyCheckResult[];
}
