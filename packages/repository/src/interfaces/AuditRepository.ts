import type { AuditAction } from '@i-evolve/core';

export interface AuditRepository {
  append(action: AuditAction): Promise<void>;
  listByMemory(memoryId: string): Promise<AuditAction[]>;
  listRecent(limit?: number): Promise<AuditAction[]>;
}
