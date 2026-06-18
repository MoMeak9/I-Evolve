import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditAction, MemoryItem } from '@i-evolve/core';
import { containsPii, containsSecret } from '@i-evolve/ai-evolution';
import { GitMemorySync } from '@i-evolve/git-sync';
import {
  MarkdownMemoryRepository,
  detectRepoIdentity,
  formatContextMarkdown,
  retrieveContextDebug,
} from '@i-evolve/storage';
import { IEvolveError } from '@i-evolve/shared';
import { paths } from './paths.js';
import { AuditWriter } from './audit-writer.js';
import type {
  DashboardRollbackInput,
  MemoryAuditInput,
  MemoryExplainInput,
  MemoryForgetInput,
  MemoryRecallInput,
  MemoryRememberInput,
  MemorySearchInput,
  MemorySyncInput,
} from './ipc-types.js';

export interface MemoryRef {
  id: string;
  scope: string;
  confidence: number;
  reason: string;
}

export class DaemonMemoryService {
  private audit = new AuditWriter();

  recall(input: MemoryRecallInput): { context: string; memories: MemoryRef[]; conflicts: unknown[]; stats: unknown } {
    const repo = this.openRepo();
    try {
      const identity = detectRepoIdentity({
        cwd: input.cwd,
        manualDomain: input.domain,
      });
      const debug = retrieveContextDebug(repo, {
        repoId: input.repoId ?? identity.repoId,
        domain: input.domain ?? identity.domain,
        packageNames: identity.packageNames,
        path: input.cwd,
        query: input.query,
      });
      return {
        context: formatContextMarkdown({
          repoId: input.repoId ?? identity.repoId,
          domain: input.domain ?? identity.domain,
          packageNames: identity.packageNames,
          path: input.cwd,
          query: input.query,
        }, debug.retrieved, input.maxTokens),
        memories: flattenRetrieved(debug.retrieved).map((memory) => ({
          id: memory.id,
          scope: memory.scope,
          confidence: memory.confidence,
          reason: `${memory.scope} matched`,
        })),
        conflicts: debug.conflicts,
        stats: debug.stats,
      };
    } finally {
      repo.close();
    }
  }

  search(input: MemorySearchInput): MemoryRef[] {
    const repo = this.openRepo();
    try {
      return repo.search(input.query).map(({ memory, rank }) => ({
        id: memory.id,
        scope: memory.scope,
        confidence: memory.confidence,
        reason: `FTS rank ${rank.toFixed(4)}`,
      }));
    } finally {
      repo.close();
    }
  }

  remember(input: MemoryRememberInput): { memoryId: string; auditId: string } {
    this.assertSafeContent(input.content);
    const repo = this.openRepo();
    try {
      const identity = detectRepoIdentity({
        cwd: input.cwd ?? process.cwd(),
        manualDomain: input.domain,
      });
      const scope = input.scope ?? (input.domain ?? identity.domain ? 'domain' : 'repo');
      const repoId = input.repoId ?? identity.repoId;
      const title = input.title ?? firstSentence(input.content);
      const id = buildMemoryId(scope, repoId, input.domain ?? identity.domain, title);
      const memory = repo.create({
        id,
        type: input.type ?? 'repo_fact',
        scope,
        repoId: scope === 'repo' ? repoId : undefined,
        domain: scope === 'domain' ? input.domain ?? identity.domain : undefined,
        title,
        content: input.content,
        status: 'active',
        visibility: 'team',
        confidence: 0.8,
        ttlDays: 180,
        tags: input.tags ?? [],
        sourceRefs: ['mcp.remember'],
      } as any);
      const auditId = this.appendAudit(memory.id, 'activate', 'memory remembered through daemon', memory.contentHash);
      return { memoryId: memory.id, auditId };
    } finally {
      repo.close();
    }
  }

  forget(input: MemoryForgetInput): { auditId: string } {
    const repo = this.openRepo();
    try {
      const current = repo.get(input.memoryId);
      repo.forget(input.memoryId, input.mode ?? 'soft');
      const auditId = this.appendAudit(
        input.memoryId,
        'forget',
        `${input.mode ?? 'soft'} forget through daemon`,
        repo.get(input.memoryId)?.contentHash,
        current?.contentHash,
      );
      return { auditId };
    } finally {
      repo.close();
    }
  }

  auditMemory(input: MemoryAuditInput): AuditAction[] {
    const actions = this.readAuditActions();
    return input.memoryId ? actions.filter((action) => action.memoryId === input.memoryId) : actions;
  }

  explainMemory(input: MemoryExplainInput): string {
    const repo = this.openRepo();
    try {
      const memory = repo.get(input.memoryId);
      if (!memory) throw new IEvolveError(`Memory not found: ${input.memoryId}`, 'MEMORY_NOT_FOUND');
      const actions = this.auditMemory({ memoryId: input.memoryId });
      const lines = [
        `${memory.id}: ${memory.title}`,
        `scope=${memory.scope} status=${memory.status} confidence=${memory.confidence} revision=${memory.revision}`,
      ];
      if (actions.length === 0) {
        lines.push('No audit records.');
      } else {
        for (const action of actions) {
          lines.push(`${action.action} by ${action.actorId}: ${action.reason}`);
        }
      }
      return lines.join('\n');
    } finally {
      repo.close();
    }
  }

  syncMemory(input: MemorySyncInput): unknown {
    if (input.action === 'status') return this.gitStatus();
    const sync = new GitMemorySync(paths.shared.memory);
    const hooks = {
      rebuildIndex: () => this.rebuildIndex(),
      appendAudit: (action: AuditAction) => this.audit.append(action),
    };
    if (input.action === 'pull') return sync.pull(hooks);
    return sync.push({ appendAudit: hooks.appendAudit });
  }

  dashboardSummary(): unknown {
    const repo = this.openRepo();
    try {
      return {
        health: { ok: true, status: 'running' },
        memories: repo.list(),
        audit: this.auditMemory({}),
        conflicts: retrieveContextDebug(repo, {}).conflicts,
        git: this.gitStatus(),
      };
    } finally {
      repo.close();
    }
  }

  dashboardMemory(input: MemoryExplainInput): unknown {
    const repo = this.openRepo();
    try {
      return {
        memory: repo.get(input.memoryId),
        audit: this.auditMemory({ memoryId: input.memoryId }),
        explanation: this.explainMemory(input),
      };
    } finally {
      repo.close();
    }
  }

  rollback(input: DashboardRollbackInput): unknown {
    const sync = new GitMemorySync(paths.shared.memory);
    return sync.rollback({
      toCommit: input.toCommit,
      mode: input.mode,
      rebuildIndex: () => this.rebuildIndex(),
      appendAudit: (action) => this.audit.append(action),
    });
  }

  rebuildIndex(): { total: number; errors: number } {
    const repo = this.openRepo();
    try {
      return repo.rebuildIndex();
    } finally {
      repo.close();
    }
  }

  gitStatus(): unknown {
    const sync = new GitMemorySync(paths.shared.memory);
    if (!sync.isInitialized()) {
      return { initialized: false, clean: null, branch: null, commit: null };
    }
    try {
      return { initialized: true, ...sync.status() };
    } catch (err) {
      return { initialized: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private openRepo(): MarkdownMemoryRepository {
    if (!existsSync(paths.shared.dir)) mkdirSync(paths.shared.dir, { recursive: true });
    return new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });
  }

  private readAuditActions(): AuditAction[] {
    if (!existsSync(paths.audit.dir)) return [];
    const actions: AuditAction[] = [];
    for (const file of readdirSync(paths.audit.dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const content = readFileSync(join(paths.audit.dir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          actions.push(JSON.parse(line) as AuditAction);
        } catch {
          // ignore malformed audit records; validate/repair reports them
        }
      }
    }
    return actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private appendAudit(
    memoryId: string,
    action: AuditAction['action'],
    reason: string,
    afterHash?: string,
    beforeHash?: string,
  ): string {
    const auditId = `audit.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    this.audit.append({
      id: auditId,
      memoryId,
      action,
      actorType: 'system',
      actorId: 'i-evolve-daemon',
      reason,
      confidence: 1,
      beforeHash,
      afterHash,
      sourceRefs: [],
      policyChecks: [{ policy: 'daemon_transaction', passed: true }],
      createdAt: new Date().toISOString(),
    });
    return auditId;
  }

  private assertSafeContent(content: string): void {
    if (containsSecret(content) || containsPii(content)) {
      throw new IEvolveError('Memory content contains secret or PII; write blocked.', 'SENSITIVE_MEMORY_BLOCKED');
    }
  }
}

function flattenRetrieved(retrieved: ReturnType<typeof retrieveContextDebug>['retrieved']): MemoryItem[] {
  return [
    ...retrieved.repo,
    ...retrieved.domain,
    ...retrieved.global,
    ...retrieved.warnings,
    ...('recent' in retrieved ? (retrieved as any).recent : []),
  ];
}

function firstSentence(content: string): string {
  const trimmed = content.trim().split(/\n+/)[0] ?? 'Remembered Memory';
  return trimmed.replace(/[.。]+$/, '').slice(0, 80) || 'Remembered Memory';
}

function buildMemoryId(scope: MemoryItem['scope'], repoId: string | undefined, domain: string | undefined, title: string): string {
  const namespace = scope === 'repo'
    ? (repoId ?? 'unknown').replace(/\//g, '-')
    : scope === 'domain'
      ? domain ?? 'unknown'
      : 'shared';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'memory';
  return `${scope}.${namespace}.${slug}`;
}
