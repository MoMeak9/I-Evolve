import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { EventBus } from './event-bus.js';
import type { MonitorEvent } from './monitor-types.js';

const HEARTBEAT_MS = 15000;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

export interface MonitorHttpOptions {
  port?: number;
  host?: string;
  staticDir?: string | null; // 前端构建产物目录;null=不托管静态页(测试用)
  logWarning?: (msg: string) => void;
}

export class MonitorHttpServer {
  private server: Server | null = null;
  private port: number;
  private host: string;
  private staticDir: string | null;
  private logWarning: (msg: string) => void;

  constructor(private bus: EventBus, opts: MonitorHttpOptions = {}) {
    this.port = opts.port ?? 17361;
    this.host = opts.host ?? '127.0.0.1';
    this.staticDir = opts.staticDir ?? null;
    this.logWarning = opts.logWarning ?? (() => {});
  }

  /** 成功返回 true;端口占用等失败返回 false(不抛错,daemon 降级继续) */
  start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.route(req, res));
      this.server.on('error', (err) => {
        this.logWarning(`MonitorHttpServer 启动失败,观测台不可用: ${(err as Error).message}`);
        this.server = null;
        resolve(false);
      });
      this.server.listen(this.port, this.host, () => resolve(true));
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server;
      if (!server) return resolve();
      this.server = null;
      server.close(() => resolve());
      // 强制断开常驻的 SSE keep-alive 连接,否则 close() 回调永不触发
      server.closeAllConnections?.();
    });
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/snapshot') return this.handleSnapshot(res);
    if (url === '/events') return this.handleEvents(req, res);
    void this.handleStatic(url, res);
  }

  private handleSnapshot(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(this.bus.snapshot()));
  }

  private handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // 立即冲刷响应头,否则客户端 fetch 在收到首个响应体字节前不会 resolve
    res.flushHeaders();
    // 断线续传:补发 Last-Event-ID 之后的缓冲事件
    const lastId = Number(req.headers['last-event-id'] ?? 0);
    if (lastId > 0) for (const e of this.bus.eventsSince(lastId)) this.writeEvent(res, e);

    const unsub = this.bus.subscribe((e) => this.writeEvent(res, e));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => { clearInterval(heartbeat); unsub(); });
  }

  private writeEvent(res: ServerResponse, e: MonitorEvent): void {
    res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
  }

  private async handleStatic(url: string, res: ServerResponse): Promise<void> {
    if (!this.staticDir) { res.writeHead(404); res.end('not found'); return; }
    const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
    const filePath = normalize(join(this.staticDir, rel));
    if (!filePath.startsWith(normalize(this.staticDir)) || !existsSync(filePath)) {
      res.writeHead(404); res.end('not found'); return;
    }
    try {
      const buf = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch (err) {
      // 读取失败(权限、竞态删除等)绝不能变成未捕获拒绝而拖垮 daemon
      this.logWarning(`MonitorHttpServer 静态文件读取失败: ${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    }
  }
}
