export interface DashboardDaemonClient {
  health(): Promise<unknown>;
  memories(): Promise<unknown[]>;
  audit(): Promise<unknown[]>;
  conflicts(): Promise<unknown[]>;
  gitStatus(): Promise<unknown>;
  forget(memoryId: string, mode: 'soft' | 'tombstone'): Promise<unknown>;
  deprecate(memoryId: string): Promise<unknown>;
  rollback(memoryId: string): Promise<unknown>;
}

export class LocalDaemonHttpClient implements DashboardDaemonClient {
  constructor(private baseUrl = 'http://127.0.0.1:17361') {}

  health(): Promise<unknown> { return this.get('/health'); }
  memories(): Promise<unknown[]> { return this.get('/memories') as Promise<unknown[]>; }
  audit(): Promise<unknown[]> { return this.get('/audit') as Promise<unknown[]>; }
  conflicts(): Promise<unknown[]> { return this.get('/conflicts') as Promise<unknown[]>; }
  gitStatus(): Promise<unknown> { return this.get('/git/status'); }
  forget(memoryId: string, mode: 'soft' | 'tombstone'): Promise<unknown> {
    return this.post(`/memories/${encodeURIComponent(memoryId)}/forget`, { mode });
  }
  deprecate(memoryId: string): Promise<unknown> {
    return this.post(`/memories/${encodeURIComponent(memoryId)}/deprecate`, {});
  }
  rollback(memoryId: string): Promise<unknown> {
    return this.post(`/memories/${encodeURIComponent(memoryId)}/rollback`, {});
  }

  private async get(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return response.json();
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  }
}
