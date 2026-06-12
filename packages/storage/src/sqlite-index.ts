import Database from 'better-sqlite3';
import type { MemoryItem } from '@i-evolve/core';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  repo_id TEXT,
  project_id TEXT,
  domain TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  confidence REAL NOT NULL,
  ttl_days INTEGER,
  expires_at TEXT,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_git_commit TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY(memory_id, tag)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  memory_id UNINDEXED,
  title,
  content,
  tags
);

CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo_id);
`;

export class SqliteIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  upsertMemory(memory: MemoryItem, filePath: string, content: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO memories
        (id, type, scope, repo_id, project_id, domain, title, status, visibility,
         confidence, ttl_days, expires_at, revision, content_hash, file_path,
         source_git_commit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id, memory.type, memory.scope,
        memory.repoId ?? null, memory.projectId ?? null, memory.domain ?? null,
        memory.title, memory.status, memory.visibility,
        memory.confidence, memory.ttlDays ?? null, memory.expiresAt ?? null,
        memory.revision, memory.contentHash, filePath,
        memory.sourceGitCommit ?? null, memory.createdAt, memory.updatedAt,
      );

      this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(memory.id);
      const insertTag = this.db.prepare('INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)');
      for (const tag of memory.tags) {
        insertTag.run(memory.id, tag);
      }

      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(memory.id);
      this.db.prepare('INSERT INTO memory_fts (memory_id, title, content, tags) VALUES (?, ?, ?, ?)')
        .run(memory.id, memory.title, content, memory.tags.join(' '));
    });
    tx();
  }

  removeMemory(memoryId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(memoryId);
      this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(memoryId);
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    });
    tx();
  }

  getMemory(id: string): (Record<string, unknown> & { tags: string[] }) | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const tags = this.db.prepare('SELECT tag FROM memory_tags WHERE memory_id = ?')
      .all(id) as Array<{ tag: string }>;
    return { ...row, tags: tags.map((t) => t.tag) };
  }

  listMemories(filter?: { status?: string; scope?: string; projectId?: string; repoId?: string }): Array<Record<string, unknown> & { tags: string[] }> {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.scope) { sql += ' AND scope = ?'; params.push(filter.scope); }
    if (filter?.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter?.repoId) { sql += ' AND repo_id = ?'; params.push(filter.repoId); }
    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const tags = this.db.prepare('SELECT tag FROM memory_tags WHERE memory_id = ?')
        .all(row.id as string) as Array<{ tag: string }>;
      return { ...row, tags: tags.map((t) => t.tag) };
    });
  }

  search(query: string, options?: { status?: string }): Array<{ memory_id: string; rank: number }> {
    let sql = `SELECT f.memory_id, rank FROM memory_fts f JOIN memories m ON m.id = f.memory_id WHERE memory_fts MATCH ?`;
    const params: unknown[] = [query];
    if (options?.status) { sql += ' AND m.status = ?'; params.push(options.status); }
    sql += ' ORDER BY rank LIMIT 50';
    return this.db.prepare(sql).all(...params) as Array<{ memory_id: string; rank: number }>;
  }

  clear(): void {
    this.db.exec('DELETE FROM memory_fts; DELETE FROM memory_tags; DELETE FROM memories;');
  }

  close(): void {
    this.db.close();
  }
}
