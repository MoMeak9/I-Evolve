import Database from 'better-sqlite3';
import type { MemoryItem } from '@i-evolve/core';

/**
 * Convert an arbitrary user string into a safe FTS5 MATCH expression.
 *
 * The raw query is otherwise interpreted as FTS5 query syntax, so bare
 * punctuation (".", "-", ":", quotes, an empty string, etc.) raises
 * `fts5: syntax error`. We tokenize on non-word characters and emit each
 * token as a double-quoted FTS5 string literal (embedded quotes doubled),
 * OR-ing them together. Returns '' when there is nothing searchable, so the
 * caller can skip the query instead of throwing.
 */
function toFtsMatchQuery(query: string): string {
  if (!query) return '';
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.join(' OR ');
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  repo_id TEXT,
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
CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo_id);

CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_vec_memory ON chunk_vectors(memory_id);
CREATE INDEX IF NOT EXISTS idx_vec_model ON chunk_vectors(model_id);
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
        (id, type, scope, repo_id, domain, title, status, visibility,
         confidence, ttl_days, expires_at, revision, content_hash, file_path,
         source_git_commit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id, memory.type, memory.scope,
        memory.repoId ?? null, memory.domain ?? null,
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
      this.db.prepare('DELETE FROM chunk_vectors WHERE memory_id = ?').run(memoryId);
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

  listMemories(filter?: { status?: string; scope?: string; repoId?: string }): Array<Record<string, unknown> & { tags: string[] }> {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.scope) { sql += ' AND scope = ?'; params.push(filter.scope); }
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
    const match = toFtsMatchQuery(query);
    if (!match) return [];
    let sql = `SELECT f.memory_id, rank FROM memory_fts f JOIN memories m ON m.id = f.memory_id WHERE memory_fts MATCH ?`;
    const params: unknown[] = [match];
    if (options?.status) { sql += ' AND m.status = ?'; params.push(options.status); }
    sql += ' ORDER BY rank LIMIT 50';
    return this.db.prepare(sql).all(...params) as Array<{ memory_id: string; rank: number }>;
  }

  upsertVectors(rows: Array<{
    chunkId: string; memoryId: string; chunkType: string; modelId: string;
    dimension: number; contentHash: string; vector: Float32Array; indexedAt: string;
  }>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunk_vectors
      (chunk_id, memory_id, chunk_type, model_id, dimension, content_hash, vector, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const buf = Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength);
        stmt.run(r.chunkId, r.memoryId, r.chunkType, r.modelId, r.dimension, r.contentHash, buf, r.indexedAt);
      }
    });
    tx();
  }

  /** 删除该 memory 在所有模型下、chunk_id 不在 keepChunkIds 中的向量。 */
  pruneVectors(memoryId: string, keepChunkIds: string[]): void {
    const rows = this.db.prepare('SELECT chunk_id FROM chunk_vectors WHERE memory_id = ?').all(memoryId) as Array<{ chunk_id: string }>;
    const keep = new Set(keepChunkIds);
    const del = this.db.prepare('DELETE FROM chunk_vectors WHERE memory_id = ? AND chunk_id = ?');
    const tx = this.db.transaction(() => {
      for (const r of rows) if (!keep.has(r.chunk_id)) del.run(memoryId, r.chunk_id);
    });
    tx();
  }

  /** 返回某 chunk 在某模型下已存的 content_hash（用于增量跳过），无则 null。 */
  getVectorHash(chunkId: string, modelId: string): string | null {
    const row = this.db.prepare('SELECT content_hash FROM chunk_vectors WHERE chunk_id = ? AND model_id = ?')
      .get(chunkId, modelId) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  /** 取该模型全部向量，JS 算点积（向量已 L2 归一化 = 余弦），返回 topN。 */
  queryNearest(queryVec: Float32Array, modelId: string, topN: number): Array<{ memory_id: string; chunk_id: string; score: number }> {
    const rows = this.db.prepare('SELECT chunk_id, memory_id, vector FROM chunk_vectors WHERE model_id = ?')
      .all(modelId) as Array<{ chunk_id: string; memory_id: string; vector: Buffer }>;
    const scored = rows.map((r) => {
      const copy = Buffer.from(r.vector);
      const v = new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
      let dot = 0;
      const n = Math.min(v.length, queryVec.length);
      for (let i = 0; i < n; i++) dot += v[i] * queryVec[i];
      return { memory_id: r.memory_id, chunk_id: r.chunk_id, score: dot };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  countByTitleSlug(titleSlug: string, status: string): number {
    const rows = this.db.prepare(
      `SELECT title FROM memories WHERE status = ?`
    ).all(status) as Array<{ title: string }>;
    return rows.filter((r) => slugifyTitle(r.title) === titleSlug).length;
  }

  listByTitleSlug(titleSlug: string, status: string): Array<{ id: string; title: string; revision: number; content_hash: string }> {
    const rows = this.db.prepare(
      `SELECT id, title, revision, content_hash FROM memories WHERE status = ? ORDER BY updated_at DESC`
    ).all(status) as Array<{ id: string; title: string; revision: number; content_hash: string }>;
    return rows.filter((r) => slugifyTitle(r.title) === titleSlug);
  }

  vectorStats(modelId: string): { vectors: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM chunk_vectors WHERE model_id = ?').get(modelId) as { n: number };
    return { vectors: row.n };
  }

  clear(): void {
    this.db.exec('DELETE FROM memory_fts; DELETE FROM memory_tags; DELETE FROM memories; DELETE FROM chunk_vectors;');
  }

  close(): void {
    this.db.close();
  }
}

function slugifyTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
