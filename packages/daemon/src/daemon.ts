import { mkdirSync, existsSync } from 'node:fs';
import { paths } from './paths.js';
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

      case 'session.finalize':
        return { ok: true, data: { sessionId: req.payload.sessionId } };

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
