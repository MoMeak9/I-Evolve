import { join } from 'node:path';
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';
import type { MemoryItem } from '@i-evolve/core';
import type { MemoryStatus } from '@i-evolve/shared';
import { ConcurrencyConflictError, MemoryNotFoundError } from '@i-evolve/shared';
import { validateMemory } from '@i-evolve/schema';
import { mapKeysCamelToSnake, mapKeysSnakeToCamel } from '@i-evolve/schema';
import { VALID_STATUS_TRANSITIONS } from '@i-evolve/shared';
import { SqliteIndex } from './sqlite-index.js';
import { atomicWriteFile, buildMarkdown, computeContentHash, serializeFrontmatter } from './markdown-writer.js';
import { parseMemoryFile } from './markdown-reader.js';

export interface MemoryRepoOptions {
  memoryDir: string;
  dbPath: string;
}

export class MarkdownMemoryRepository {
  private index: SqliteIndex;
  private memoryDir: string;

  constructor(opts: MemoryRepoOptions) {
    this.memoryDir = opts.memoryDir;
    this.index = new SqliteIndex(opts.dbPath);
    if (!existsSync(this.memoryDir)) mkdirSync(this.memoryDir, { recursive: true });
  }

  get(id: string): MemoryItem | null {
    const row = this.index.getMemory(id);
    if (!row) return null;
    const filePath = row.file_path as string;
    if (!existsSync(filePath)) return null;
    const { frontmatter, content } = parseMemoryFile(filePath);
    const camel = mapKeysSnakeToCamel(frontmatter) as unknown as MemoryItem;
    return { ...camel, content };
  }

  list(filter?: { status?: string; scope?: string; projectId?: string; repoId?: string }): MemoryItem[] {
    const rows = this.index.listMemories(filter);
    return rows.map((row) => {
      const filePath = row.file_path as string;
      if (!existsSync(filePath)) return null;
      const { frontmatter, content } = parseMemoryFile(filePath);
      const camel = mapKeysSnakeToCamel(frontmatter) as unknown as MemoryItem;
      return { ...camel, content };
    }).filter(Boolean) as MemoryItem[];
  }

  search(query: string): Array<{ memory: MemoryItem; rank: number }> {
    const results = this.index.search(query, { status: 'active' });
    const now = Date.now();
    return results.map((r) => {
      const memory = this.get(r.memory_id);
      if (!memory) return null;
      if (this.isExpired(memory, now)) return null;
      return { memory, rank: r.rank };
    }).filter(Boolean) as Array<{ memory: MemoryItem; rank: number }>;
  }

  create(input: Omit<MemoryItem, 'revision' | 'contentHash' | 'createdAt' | 'updatedAt'> & { content: string }): MemoryItem {
    this.assertNotTombstoned(input.id);

    const now = new Date().toISOString();
    const contentHash = computeContentHash(input.content);

    const memory: MemoryItem = {
      ...input,
      revision: 1,
      contentHash,
      createdAt: now,
      updatedAt: now,
    };

    const snakeFm = mapKeysCamelToSnake(this.toFrontmatterObj(memory));
    const result = validateMemory(snakeFm);
    if (!result.valid) {
      throw new Error(`Schema validation failed: ${result.errors.map(e => e.message).join(', ')}`);
    }

    const filePath = this.resolveFilePath(memory);
    const markdown = buildMarkdown(snakeFm as Record<string, unknown>, input.content);
    atomicWriteFile(filePath, markdown);
    this.index.upsertMemory(memory, filePath, input.content);

    return memory;
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryItem, 'title' | 'confidence' | 'ttlDays' | 'expiresAt' | 'tags' | 'appliesTo'>> & { content?: string },
    options: { expectedRevision: number; expectedContentHash: string },
  ): MemoryItem {
    const current = this.get(id);
    if (!current) throw new MemoryNotFoundError(id);
    if (current.revision !== options.expectedRevision) {
      throw new ConcurrencyConflictError(id);
    }
    if (current.contentHash !== options.expectedContentHash) {
      throw new ConcurrencyConflictError(id);
    }

    const content = patch.content ?? current.content;
    const now = new Date().toISOString();
    const updated: MemoryItem = {
      ...current,
      ...patch,
      content,
      revision: current.revision + 1,
      contentHash: computeContentHash(content),
      updatedAt: now,
    };

    const snakeFm = mapKeysCamelToSnake(this.toFrontmatterObj(updated));
    const result = validateMemory(snakeFm);
    if (!result.valid) {
      throw new Error(`Schema validation failed: ${result.errors.map(e => e.message).join(', ')}`);
    }

    const filePath = this.resolveFilePath(updated);
    const markdown = buildMarkdown(snakeFm as Record<string, unknown>, content);
    atomicWriteFile(filePath, markdown);
    this.index.upsertMemory(updated, filePath, content);

    return updated;
  }

  changeStatus(id: string, newStatus: MemoryStatus, options: { expectedRevision: number }): MemoryItem {
    const current = this.get(id);
    if (!current) throw new MemoryNotFoundError(id);
    if (current.revision !== options.expectedRevision) {
      throw new ConcurrencyConflictError(id);
    }

    const validTransitions = VALID_STATUS_TRANSITIONS[current.status];
    if (!validTransitions?.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${current.status} → ${newStatus}`);
    }

    return this.update(id, { ...current, status: newStatus } as any, {
      expectedRevision: options.expectedRevision,
      expectedContentHash: current.contentHash,
    });
  }

  forget(id: string, mode: 'soft' | 'tombstone'): void {
    const current = this.get(id);
    if (!current) throw new MemoryNotFoundError(id);

    if (mode === 'soft') {
      this.changeStatus(id, 'deprecated', { expectedRevision: current.revision });
    } else {
      const filePath = this.resolveFilePath(current);
      const tombstoneDir = join(this.memoryDir, 'tombstones');
      if (!existsSync(tombstoneDir)) mkdirSync(tombstoneDir, { recursive: true });
      const tombstonePath = join(tombstoneDir, `${id}.md`);
      if (existsSync(filePath)) renameSync(filePath, tombstonePath);
      this.index.removeMemory(id);
    }
  }

  rebuildIndex(): { total: number; errors: number } {
    this.index.clear();
    let total = 0;
    let errors = 0;

    const scanDir = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'tombstones') {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const { frontmatter, content } = parseMemoryFile(fullPath);
            const camel = mapKeysSnakeToCamel(frontmatter) as unknown as MemoryItem;
            const memory = { ...camel, content };
            const validation = validateMemory(frontmatter);
            if (!validation.valid) {
              errors++;
              continue;
            }
            this.index.upsertMemory(memory, fullPath, content);
            total++;
          } catch {
            errors++;
          }
        }
      }
    };

    scanDir(this.memoryDir);
    return { total, errors };
  }

  close(): void {
    this.index.close();
  }

  private resolveFilePath(memory: MemoryItem): string {
    const scope = memory.scope;
    let namespace: string;

    switch (scope) {
      case 'global': namespace = 'global'; break;
      case 'domain': namespace = `domains/${memory.domain ?? 'unknown'}`; break;
      case 'project': namespace = `projects/${memory.projectId ?? 'unknown'}`; break;
      case 'repo': namespace = `repos/${memory.repoId?.replace(/\//g, '-') ?? 'unknown'}`; break;
      case 'user': namespace = `users/${memory.id.split('.')[0] ?? 'unknown'}`; break;
      case 'task': namespace = `tasks`; break;
      default: namespace = 'other';
    }

    const slug = memory.id.split('.').pop() ?? memory.id;
    return join(this.memoryDir, namespace, `${slug}.md`);
  }

  private toFrontmatterObj(memory: MemoryItem): Record<string, unknown> {
    const { content, ...fm } = memory as any;
    return stripUndefined(fm);
  }

  private tombstonePath(id: string): string {
    return join(this.memoryDir, 'tombstones', `${id}.md`);
  }

  private assertNotTombstoned(id: string): void {
    if (existsSync(this.tombstonePath(id))) {
      throw new Error(`Memory id is tombstoned and cannot be reused: ${id}`);
    }
  }

  private isExpired(memory: MemoryItem, now: number): boolean {
    if (!memory.expiresAt) return false;
    return Date.parse(memory.expiresAt) <= now;
  }
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
