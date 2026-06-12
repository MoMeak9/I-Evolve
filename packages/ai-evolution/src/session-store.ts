import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionSummary } from '@i-evolve/core';

/**
 * Stores session summaries at {baseDir}/{yyyy-mm}/{session_id}.json.
 * Session summaries are local-only (not Git) per MVP3 spec.
 */
export class SessionStore {
  constructor(private baseDir: string) {}

  save(summary: SessionSummary): string {
    const yyyymm = monthBucket(summary.endedAt);
    const dir = join(this.baseDir, yyyymm);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${summary.sessionId}.json`);
    writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
    return filePath;
  }

  load(sessionId: string): SessionSummary | null {
    if (!existsSync(this.baseDir)) return null;
    for (const month of readdirSync(this.baseDir)) {
      const filePath = join(this.baseDir, month, `${sessionId}.json`);
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionSummary;
      }
    }
    return null;
  }
}

function monthBucket(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
