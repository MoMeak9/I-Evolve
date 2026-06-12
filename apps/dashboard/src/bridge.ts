import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { sendRequest } from '@i-evolve/daemon';

const DEFAULT_PORT = 17361;

export function startDashboardBridge(port = Number(process.env.IEVOLVE_DASHBOARD_PORT ?? DEFAULT_PORT)) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      respond(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`I-Evolve dashboard bridge listening on http://127.0.0.1:${port}`);
  });
  return server;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = req.method ?? 'GET';
  if (method === 'GET' && url.pathname === '/health') return proxy(res, { type: 'health' });
  if (method === 'GET' && url.pathname === '/memories') return proxyData(res, { type: 'dashboard.summary', payload: {} }, 'memories');
  if (method === 'GET' && url.pathname === '/audit') return proxyData(res, { type: 'dashboard.summary', payload: {} }, 'audit');
  if (method === 'GET' && url.pathname === '/conflicts') return proxyData(res, { type: 'dashboard.summary', payload: {} }, 'conflicts');
  if (method === 'GET' && url.pathname === '/git/status') return proxy(res, { type: 'git.status' });
  if (method === 'POST' && url.pathname === '/index/rebuild') return proxy(res, { type: 'index.rebuild', payload: {} });
  if (method === 'POST' && url.pathname === '/git/pull') return proxy(res, { type: 'memory.sync', payload: { action: 'pull' } });
  if (method === 'POST' && url.pathname === '/git/push') return proxy(res, { type: 'memory.sync', payload: { action: 'push' } });

  const memoryAction = url.pathname.match(/^\/memories\/([^/]+)\/(forget|deprecate|rollback)$/);
  if (method === 'POST' && memoryAction) {
    const memoryId = decodeURIComponent(memoryAction[1]);
    const action = memoryAction[2];
    if (action === 'forget') return proxy(res, { type: 'memory.forget', payload: { memoryId, mode: 'soft' } });
    if (action === 'deprecate') return proxy(res, { type: 'memory.forget', payload: { memoryId, mode: 'soft' } });
    const body = await readJson(req);
    return proxy(res, { type: 'dashboard.rollback', payload: { toCommit: body.toCommit ?? body.commit ?? memoryId } });
  }

  const detail = url.pathname.match(/^\/memories\/([^/]+)$/);
  if (method === 'GET' && detail) return proxy(res, { type: 'dashboard.memory', payload: { memoryId: decodeURIComponent(detail[1]) } });

  respond(res, 404, { ok: false, error: 'Not found' });
}

async function proxy(res: ServerResponse, request: any): Promise<void> {
  const response = await sendRequest(request);
  respond(res, response.ok ? 200 : 500, response.ok ? response.data : response);
}

async function proxyData(res: ServerResponse, request: any, key: string): Promise<void> {
  const response = await sendRequest<any>(request);
  respond(res, response.ok ? 200 : 500, response.ok ? response.data?.[key] ?? [] : response);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk.toString();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': 'http://127.0.0.1:17361',
  });
  res.end(JSON.stringify(body));
}

if (process.argv[1]?.endsWith('bridge.js')) {
  startDashboardBridge();
}
