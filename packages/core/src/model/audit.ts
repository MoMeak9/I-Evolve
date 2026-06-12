import type { AuditActionType, ActorType, PolicyCheckResult } from '@i-evolve/shared';

export interface AuditAction {
  id: string;
  memoryId: string;
  action: AuditActionType;
  actorType: ActorType;
  actorId: string;
  reason: string;
  confidence: number;
  beforeHash?: string;
  afterHash?: string;
  sourceRefs: string[];
  policyChecks: PolicyCheckResult[];
  createdAt: string;
}
