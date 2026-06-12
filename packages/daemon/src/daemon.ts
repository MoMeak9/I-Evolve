import { mkdirSync, existsSync } from 'node:fs';
import { paths } from './paths.js';
import { ProcessLock } from './lock.js';
import { IpcServer, type RequestHandler } from './ipc-server.js';
import { ObservationWriter } from './observation-writer.js';
import { AuditWriter } from './audit-writer.js';
import { SerialTransactionManager } from './transaction-manager.js';
import type { DaemonRequest, DaemonResponse } from './ipc-types.js';

export class Daemon {
  private lock = new ProcessLock();
  private ipc: IpcServer;
  private observations = new ObservationWriter();
  private audit = new AuditWriter();
  private txManager = new SerialTransactionManager();
  private startedAt: string | null = null;

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

    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  async stop(): Promise<void> {
    await this.ipc.stop();
    this.lock.release();
    this.startedAt = null;
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

      default:
        return {
          ok: false,
          error: { code: 'UNKNOWN_REQUEST', message: `Unknown request type` },
        };
    }
  };

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
