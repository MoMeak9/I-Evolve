import type { MemoryItem } from '@i-evolve/core';
import type { MemoryStatus } from '@i-evolve/shared';
import type { Transaction } from './TransactionManager.js';

export interface MemoryFilter {
  status?: MemoryStatus[];
  scope?: string[];
  repoId?: string;
  domain?: string;
  tags?: string[];
}

export interface MemorySearchQuery {
  text: string;
  scope?: string[];
  repoId?: string;
  limit?: number;
}

export interface MemorySearchResult {
  memory: MemoryItem;
  score: number;
}

export interface CreateMemoryInput {
  id: string;
  type: MemoryItem['type'];
  scope: MemoryItem['scope'];
  title: string;
  content: string;
  confidence: number;
  repoId?: string;
  domain?: string;
  tags?: string[];
  sourceRefs?: string[];
  appliesTo?: MemoryItem['appliesTo'];
  visibility?: MemoryItem['visibility'];
  ttlDays?: number | null;
}

export interface UpdateMemoryPatch {
  title?: string;
  content?: string;
  confidence?: number;
  tags?: string[];
  appliesTo?: MemoryItem['appliesTo'];
  ttlDays?: number | null;
}

export interface AuditActionInput {
  action: string;
  actorType: string;
  actorId: string;
  reason: string;
  confidence: number;
  sourceRefs?: string[];
}

export interface RebuildIndexOptions {
  force?: boolean;
}

export interface MemoryRepository {
  get(id: string): Promise<MemoryItem | null>;
  list(filter?: MemoryFilter): Promise<MemoryItem[]>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;
  create(input: CreateMemoryInput, tx?: Transaction): Promise<MemoryItem>;
  update(
    id: string,
    patch: UpdateMemoryPatch,
    options: { expectedRevision: number; expectedContentHash: string },
    tx?: Transaction,
  ): Promise<MemoryItem>;
  changeStatus(
    id: string,
    status: MemoryStatus,
    action: AuditActionInput,
    options: { expectedRevision: number },
    tx?: Transaction,
  ): Promise<MemoryItem>;
  forget(
    id: string,
    mode: 'soft' | 'tombstone',
    action: AuditActionInput,
    tx?: Transaction,
  ): Promise<void>;
  rebuildIndex(options?: RebuildIndexOptions): Promise<void>;
}
