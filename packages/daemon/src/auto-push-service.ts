import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readSyncConfig } from './read-sync-config.js';
import type { GitMemorySync } from '@i-evolve/git-sync';
import type { AuditAction } from '@i-evolve/core';

interface PendingPushEntry {
  memoryId: string;
  reason: string;
  failedAt: string;
  attempts: number;
  lastError: string;
}

const MAX_ATTEMPTS = 5;

export class AutoPushService {
  constructor(
    private gitSync: GitMemorySync,
    private configPath: string,
    private queuePath: string,
    private appendAudit: (action: AuditAction) => void,
  ) {}

  async onPromoted(memory: { id: string; visibility: string }): Promise<void> {
    const config = readSyncConfig(this.configPath);
    if (!config.autoPush) return;
    if (memory.visibility === 'private') return;
    if (!this.gitSync.hasRemote()) return;

    const result = await this.gitSync.push({ appendAudit: this.appendAudit });
    if (result.ok) {
      this.clearQueue();
      this.emitAudit('auto_push_success', memory.id, 'push succeeded after promotion');
    } else {
      this.enqueue(memory.id, result.message);
      this.emitAudit('auto_push_failed', memory.id, result.message);
    }
  }

  async flush(): Promise<{ pushed: number; failed: number }> {
    const queue = this.readQueue();
    if (queue.length === 0) return { pushed: 0, failed: 0 };

    const abandoned = queue.filter((e) => e.attempts >= MAX_ATTEMPTS);
    for (const entry of abandoned) {
      this.emitAudit('auto_push_abandoned', entry.memoryId, `exceeded ${MAX_ATTEMPTS} attempts: ${entry.lastError}`);
    }
    const remaining = queue.filter((e) => e.attempts < MAX_ATTEMPTS);

    if (remaining.length === 0) {
      this.writeQueue([]);
      return { pushed: 0, failed: 0 };
    }

    const result = await this.gitSync.push({ appendAudit: this.appendAudit });
    if (result.ok) {
      this.writeQueue([]);
      return { pushed: remaining.length, failed: 0 };
    }

    for (const entry of remaining) {
      entry.attempts++;
      entry.lastError = result.message;
      entry.failedAt = new Date().toISOString();
    }
    this.writeQueue(remaining);
    return { pushed: 0, failed: remaining.length };
  }

  private enqueue(memoryId: string, error: string): void {
    const queue = this.readQueue();
    if (queue.some((e) => e.memoryId === memoryId)) return;
    queue.push({
      memoryId,
      reason: 'promotion',
      failedAt: new Date().toISOString(),
      attempts: 1,
      lastError: error,
    });
    this.writeQueue(queue);
  }

  private clearQueue(): void {
    this.writeQueue([]);
  }

  private readQueue(): PendingPushEntry[] {
    if (!existsSync(this.queuePath)) return [];
    try {
      return JSON.parse(readFileSync(this.queuePath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private writeQueue(queue: PendingPushEntry[]): void {
    writeFileSync(this.queuePath, JSON.stringify(queue), 'utf-8');
  }

  private emitAudit(action: AuditAction['action'], memoryId: string, reason: string): void {
    this.appendAudit({
      id: `audit.${Date.now()}.${Math.random().toString(16).slice(2)}`,
      memoryId,
      action,
      actorType: 'system',
      actorId: 'i-evolve-auto-push',
      reason,
      confidence: 1,
      sourceRefs: [],
      policyChecks: [{ policy: 'auto_push_gate', passed: true }],
      createdAt: new Date().toISOString(),
    });
  }
}
