import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';
import { UnifiedExtractor, getProvider, SessionStore, PolicyJudge } from '@i-evolve/ai-evolution';
import { MarkdownMemoryRepository } from '@i-evolve/storage';
import { AsyncFinalizer } from './async-finalizer.js';
import type { Observation } from '@i-evolve/core';
import { ProcessLock } from './lock.js';
import { IpcServer, type RequestHandler } from './ipc-server.js';
import { ObservationWriter } from './observation-writer.js';
import { AuditWriter } from './audit-writer.js';
import { SerialTransactionManager } from './transaction-manager.js';
import type { DaemonRequest, DaemonResponse } from './ipc-types.js';
import { DaemonMemoryService } from './memory-service.js';
import { IEvolveError } from '@i-evolve/shared';

export class Daemon {
  private lock = new ProcessLock();
  private ipc: IpcServer;
  private observations = new ObservationWriter();
  private audit = new AuditWriter();
  private memory = new DaemonMemoryService();
  private txManager = new SerialTransactionManager();
  private startedAt: string | null = null;
  private signalHandler = () => void this.stop();

  constructor() {
    this.ipc = new IpcServer(this.handleRequest.bind(this));
  }

  async start(): Promise<void> {
    this.ensureDirs();

    const lockResult = this.lock.acquire();
    if (!lockResult.acquired) {
      if (lockResult.stalePid !== undefined) {
        throw new Error(
          `Stale lock detected (pid ${lockResult.stalePid} is dead). Run: i-evolve repair stale-lock`,
        );
      }
      throw new Error('Another daemon instance is already running.');
    }

    await this.ipc.start();
    this.startedAt = new Date().toISOString();

    process.on('SIGTERM', this.signalHandler);
    process.on('SIGINT', this.signalHandler);
  }

  async stop(): Promise<void> {
    await this.ipc.stop();
    this.lock.release();
    this.startedAt = null;
    process.off('SIGTERM', this.signalHandler);
    process.off('SIGINT', this.signalHandler);
  }

  get transactionManager(): SerialTransactionManager {
    return this.txManager;
  }

  private handleRequest: RequestHandler = async (req: DaemonRequest): Promise<DaemonResponse> => {
    switch (req.type) {
      case 'ping':
        return { ok: true, data: { pong: true } };

      case 'health':
        return {
          ok: true,
          data: {
            status: 'running',
            startedAt: this.startedAt,
            pid: process.pid,
          },
        };

      case 'observe':
        return this.txManager.run('observe', { name: 'observe' }, async () => {
          this.observations.append(req.payload);
          return { ok: true, data: { id: req.payload.id } } as DaemonResponse;
        });

      case 'audit.append':
        return this.txManager.run('audit.append', { name: 'audit.append' }, async () => {
          this.audit.append(req.payload);
          return { ok: true, data: { id: req.payload.id } } as DaemonResponse;
        });

      case 'session.start':
        return { ok: true, data: { sessionId: req.payload.sessionId } };

      case 'session.finalize': {
        const { sessionId, autoEvolve } = req.payload;
        setImmediate(() => this.runAsyncFinalize(sessionId, autoEvolve ?? false));
        return { ok: true, data: { queued: true, sessionId } };
      }

      case 'memory.recall':
        return this.handleMemoryRead(() => this.memory.recall(req.payload));

      case 'memory.search':
        return this.handleMemoryRead(() => this.memory.search(req.payload));

      case 'memory.remember':
        return this.txManager.run('memory.remember', { name: 'memory.remember' }, async () =>
          this.handleMemoryRead(() => this.memory.remember(req.payload)));

      case 'memory.forget':
        return this.txManager.run('memory.forget', { name: 'memory.forget' }, async () =>
          this.handleMemoryRead(() => this.memory.forget(req.payload)));

      case 'memory.audit':
        return this.handleMemoryRead(() => this.memory.auditMemory(req.payload));

      case 'memory.explain':
        return this.handleMemoryRead(() => ({ explanation: this.memory.explainMemory(req.payload) }));

      case 'memory.sync':
        return this.txManager.run('memory.sync', { name: 'memory.sync' }, async () =>
          this.handleMemoryRead(() => this.memory.syncMemory(req.payload)));

      case 'dashboard.summary':
        return this.handleMemoryRead(() => this.memory.dashboardSummary());

      case 'dashboard.memory':
        return this.handleMemoryRead(() => this.memory.dashboardMemory(req.payload));

      case 'dashboard.rollback':
        return this.txManager.run('dashboard.rollback', { name: 'dashboard.rollback' }, async () =>
          this.handleMemoryRead(() => this.memory.rollback(req.payload)));

      case 'index.rebuild':
        return this.txManager.run('index.rebuild', { name: 'index.rebuild' }, async () =>
          this.handleMemoryRead(() => this.memory.rebuildIndex()));

      case 'git.status':
        return this.handleMemoryRead(() => this.memory.gitStatus());

      default:
        return {
          ok: false,
          error: { code: 'UNKNOWN_REQUEST', message: `Unknown request type` },
        };
    }
  };

  private async runAsyncFinalize(sessionId: string, autoEvolve: boolean): Promise<void> {
    const observations = this.readObservationsForSession(sessionId);
    if (observations.length === 0) return;

    const provider = getProvider();
    const extractor = new UnifiedExtractor(provider);
    const judge = new PolicyJudge();
    const store = new SessionStore(paths.sessions.dir);

    const repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });

    const finalizer = new AsyncFinalizer({
      extract: (obs, sid, rid) => extractor.extract(obs, sid, rid),
      saveSession: (summary) => store.save(summary),
      countCandidatesBySlug: (slug) => repo.countCandidatesBySlug(slug),
      createMemory: (input) => repo.create(input),
      promoteCandidatesBySlug: (slug, content, newId) => repo.promoteCandidatesBySlug(slug, content, newId),
      appendAudit: (action) => {
        const dir = paths.audit.dir;
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const month = new Date(action.createdAt).toISOString().slice(0, 7);
        appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(action) + '\n', 'utf-8');
      },
      judgeCandidate: (candidate) => judge.judge(candidate),
      logWarning: (msg) => {
        const logDir = paths.logs.dir;
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, 'async-finalizer.log'), `[${new Date().toISOString()}] WARN: ${msg}\n`, 'utf-8');
      },
    });

    try {
      await finalizer.finalize(observations, sessionId);
    } finally {
      repo.close();
    }
  }

  private readObservationsForSession(sessionId: string): Observation[] {
    const file = paths.observations.current;
    if (!existsSync(file)) return [];
    const observations: Observation[] = [];
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obs = JSON.parse(line) as Observation;
        if (obs.sessionId === sessionId) observations.push(obs);
      } catch { /* skip malformed lines */ }
    }
    return observations;
  }

  private async handleMemoryRead<T>(fn: () => T | Promise<T>): Promise<DaemonResponse<T>> {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      const code = err instanceof IEvolveError ? err.code : 'DAEMON_REQUEST_FAILED';
      return {
        ok: false,
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private ensureDirs(): void {
    for (const dir of [
      paths.runtime.dir,
      paths.observations.dir,
      paths.audit.dir,
      paths.logs.dir,
      paths.shared.dir,
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }
}
