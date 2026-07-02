import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.js';
import { UnifiedExtractor, getProvider, SessionStore, PolicyJudge } from '@i-evolve/ai-evolution';
import { MarkdownMemoryRepository } from '@i-evolve/storage';
import { AsyncFinalizer, type AsyncFinalizerDeps } from './async-finalizer.js';
import type { Observation } from '@i-evolve/core';
import { ProcessLock } from './lock.js';
import { IpcServer, type RequestHandler } from './ipc-server.js';
import { ObservationWriter } from './observation-writer.js';
import { AuditWriter } from './audit-writer.js';
import { SerialTransactionManager } from './transaction-manager.js';
import type { DaemonRequest, DaemonResponse } from './ipc-types.js';
import { DaemonMemoryService } from './memory-service.js';
import { IEvolveError } from '@i-evolve/shared';
import { AutoPushService } from './auto-push-service.js';
import { GitMemorySync } from '@i-evolve/git-sync';
import { EventBus } from './event-bus.js';
import { MonitorHttpServer } from './monitor-http-server.js';
import { instrumentFinalizerDeps } from './pipeline-events.js';
import { MONITOR_EVENT } from './monitor-types.js';

export class Daemon {
  private lock = new ProcessLock();
  private ipc: IpcServer;
  private observations = new ObservationWriter();
  private audit = new AuditWriter();
  private memory = new DaemonMemoryService();
  private txManager = new SerialTransactionManager();
  private startedAt: string | null = null;
  private signalHandler = () => void this.stop();
  private autoPush: AutoPushService;
  readonly eventBus = new EventBus();
  private monitorHttp: MonitorHttpServer;

  constructor() {
    this.ipc = new IpcServer(this.handleRequest.bind(this));
    const gitSync = new GitMemorySync(paths.shared.memory);
    this.autoPush = new AutoPushService(
      gitSync,
      join(paths.shared.memory, 'memory-pack.yaml'),
      join(paths.shared.memory, '.pending-push.json'),
      (action) => this.audit.append(action),
    );
    const here = dirname(fileURLToPath(import.meta.url));
    const staticDir = join(here, '..', '..', '..', 'apps', 'dashboard');
    this.monitorHttp = new MonitorHttpServer(this.eventBus, {
      staticDir,
      logWarning: (msg) => this.logDaemonWarning(msg),
    });
  }

  private logDaemonWarning(msg: string): void {
    try {
      const dir = paths.logs.dir;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'monitor.log'), `[${new Date().toISOString()}] WARN: ${msg}\n`, 'utf-8');
    } catch { /* 日志失败不影响 daemon */ }
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
    await this.monitorHttp.start();
    this.startedAt = new Date().toISOString();
    this.autoPush.flush().catch(() => {});

    process.on('SIGTERM', this.signalHandler);
    process.on('SIGINT', this.signalHandler);
  }

  async stop(): Promise<void> {
    await this.ipc.stop();
    await this.monitorHttp.stop();
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
          this.eventBus.emit({
            stage: 'observe', type: MONITOR_EVENT.observationReceived,
            sessionId: req.payload.sessionId,
            summary: `收到观测:${String(req.payload.summary ?? '').slice(0, 40)}`,
            detail: { id: req.payload.id, source: req.payload.source, phase: req.payload.phase },
          });
          return { ok: true, data: { id: req.payload.id } } as DaemonResponse;
        });

      case 'audit.append':
        return this.txManager.run('audit.append', { name: 'audit.append' }, async () => {
          this.audit.append(req.payload);
          return { ok: true, data: { id: req.payload.id } } as DaemonResponse;
        });

      case 'session.start':
        this.eventBus.emit({
          stage: 'observe', type: MONITOR_EVENT.sessionStart,
          sessionId: req.payload.sessionId,
          summary: `会话开始:${req.payload.sessionId}`,
        });
        return { ok: true, data: { sessionId: req.payload.sessionId } };

      case 'session.finalize': {
        const { sessionId, autoEvolve } = req.payload;
        this.eventBus.emit({
          stage: 'observe', type: MONITOR_EVENT.sessionFinalize,
          sessionId,
          summary: `会话收尾,进入异步流水线:${sessionId}`,
        });
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
          this.handleMemoryRead(() => {
            const result = this.memory.forget(req.payload);
            this.eventBus.emit({
              stage: 'store', type: MONITOR_EVENT.memoryForgotten,
              summary: `遗忘记忆:${req.payload.memoryId}`,
              detail: { memoryId: req.payload.memoryId, mode: req.payload.mode ?? 'soft' },
            });
            return result;
          }));

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
          this.handleMemoryRead(() => {
            const result = this.memory.rollback(req.payload);
            this.eventBus.emit({
              stage: 'store', type: MONITOR_EVENT.memoryRolledback,
              summary: `回滚到提交:${req.payload.toCommit}`,
              detail: { toCommit: req.payload.toCommit, mode: req.payload.mode ?? 'checkout' },
            });
            return result;
          }));

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

    const baseDeps = {
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
        this.eventBus.emit({ stage: 'system', type: MONITOR_EVENT.warning, sessionId, summary: msg, level: 'warn' });
      },
      onPromoted: (memory) => this.autoPush.onPromoted(memory),
    } satisfies AsyncFinalizerDeps;

    const finalizer = new AsyncFinalizer(
      instrumentFinalizerDeps(baseDeps, this.eventBus, sessionId),
    );

    try {
      await finalizer.finalize(observations, sessionId);
      const flushResult = await this.autoPush.flush();
      if (flushResult.pushed > 0) {
        this.eventBus.emit({
          stage: 'sync', type: MONITOR_EVENT.autopushPushed, sessionId,
          summary: `已推送 ${flushResult.pushed} 条记忆`,
          detail: { pushed: flushResult.pushed, failed: flushResult.failed },
        });
      }
    } catch (err) {
      this.eventBus.emit({
        stage: 'system', type: MONITOR_EVENT.pipelineError, sessionId,
        summary: `流水线错误:${err instanceof Error ? err.message : String(err)}`,
        level: 'error',
      });
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
