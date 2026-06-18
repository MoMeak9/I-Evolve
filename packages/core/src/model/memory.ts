import type { MemoryStatus, MemoryType, MemoryScope, MemoryVisibility, AppliesTo } from '@i-evolve/shared';

export interface MemoryItem {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  repoId?: string;
  domain?: string;
  title: string;
  content: string;
  status: MemoryStatus;
  visibility: MemoryVisibility;
  confidence: number;
  ttlDays?: number | null;
  expiresAt?: string | null;
  appliesTo?: AppliesTo;
  tags: string[];
  sourceRefs: string[];
  revision: number;
  contentHash: string;
  sourceGitCommit?: string;
  supersedes?: string[];
  deprecatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
