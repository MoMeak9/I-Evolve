import type { MemoryItem } from '@i-evolve/core';

export interface IndexQuery {
  text: string;
  scope?: string[];
  repoId?: string;
  projectId?: string;
  limit?: number;
}

export interface IndexSearchResult {
  memoryId: string;
  score: number;
  snippet?: string;
}

export interface IndexHealthReport {
  totalMemories: number;
  indexedMemories: number;
  staleEntries: number;
  lastRebuilt?: string;
}

export interface MarkdownMemorySource {
  directory: string;
  glob?: string;
}

export interface IndexRepository {
  upsertMemory(memory: MemoryItem): Promise<void>;
  removeMemory(memoryId: string): Promise<void>;
  search(query: IndexQuery): Promise<IndexSearchResult[]>;
  rebuildFromMarkdown(source: MarkdownMemorySource): Promise<void>;
  healthCheck(): Promise<IndexHealthReport>;
}
