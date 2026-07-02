import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from './event-bus.js';
import { MonitorHttpServer } from './monitor-http-server.js';

const PORT = 17398; // 测试端口,避开默认 17361 与 monitor-http-server.test 的 17399

// 与 daemon.ts 相同的解析方式:从 packages/daemon/src 上溯三级到仓库根,再进入 apps/dashboard
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', '..', '..', 'apps', 'dashboard');

describe('MonitorHttpServer 静态托管 dashboard', () => {
  let server: MonitorHttpServer;
  afterEach(async () => { await server?.stop(); });

  it('GET / 返回 dashboard 的 index.html', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, { port: PORT, staticDir });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('I-Evolve');
  });

  it('GET /src/styles.css 返回 text/css', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, { port: PORT, staticDir });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT}/src/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('GET /dist/main.js 返回 JS(构建产物存在时)', async () => {
    const bus = new EventBus();
    server = new MonitorHttpServer(bus, { port: PORT, staticDir });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${PORT}/dist/main.js`);
    if (existsSync(join(staticDir, 'dist', 'main.js'))) {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
    } else {
      // 未构建时静态处理器返回 404,而非崩溃;此为可接受降级
      expect(res.status).toBe(404);
    }
  });
});
