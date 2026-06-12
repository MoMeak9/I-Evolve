import { sendRequest, type DaemonResponse } from '@i-evolve/daemon';

export interface McpMemoryRef {
  id: string;
  scope: string;
  confidence: number;
  reason: string;
}

export interface DaemonClient {
  health(): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>;
  recall(input: { query?: string; cwd: string; maxTokens?: number }): Promise<string>;
  searchMemory(input: { query: string }): Promise<McpMemoryRef[]>;
  auditMemory(input: { memoryId?: string }): Promise<unknown[]>;
  explainMemory(input: { memoryId: string }): Promise<string>;
  remember(input: { content: string; cwd?: string }): Promise<{ auditId?: string }>;
  forget(input: { memoryId: string; mode?: 'soft' | 'tombstone' }): Promise<{ auditId?: string }>;
  syncMemory(input: { action: 'pull' | 'push' | 'status' }): Promise<{ message: string }>;
}

export class IpcDaemonClient implements DaemonClient {
  health(): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
    return sendRequest({ type: 'health' });
  }

  async recall(input: { query?: string; cwd: string; maxTokens?: number }): Promise<string> {
    const resp = await request<{ context: string }>({ type: 'memory.recall', payload: input });
    return resp.context;
  }

  async searchMemory(input: { query: string }): Promise<McpMemoryRef[]> {
    return request<McpMemoryRef[]>({ type: 'memory.search', payload: input });
  }

  auditMemory(input: { memoryId?: string }): Promise<unknown[]> {
    return request<unknown[]>({ type: 'memory.audit', payload: input });
  }

  async explainMemory(input: { memoryId: string }): Promise<string> {
    const resp = await request<{ explanation: string }>({ type: 'memory.explain', payload: input });
    return resp.explanation;
  }

  remember(input: { content: string; cwd?: string }): Promise<{ auditId?: string }> {
    return request<{ auditId?: string }>({ type: 'memory.remember', payload: input });
  }

  forget(input: { memoryId: string; mode?: 'soft' | 'tombstone' }): Promise<{ auditId?: string }> {
    return request<{ auditId?: string }>({ type: 'memory.forget', payload: input });
  }

  syncMemory(input: { action: 'pull' | 'push' | 'status' }): Promise<{ message: string }> {
    return request<{ message: string }>({ type: 'memory.sync', payload: input });
  }
}

async function request<T>(message: Parameters<typeof sendRequest<T>>[0]): Promise<T> {
  const resp: DaemonResponse<T> = await sendRequest<T>(message as any);
  if (!resp.ok) {
    const err = new Error(resp.error?.message ?? 'Daemon request failed');
    (err as any).code = resp.error?.code ?? 'DAEMON_REQUEST_FAILED';
    throw err;
  }
  return resp.data as T;
}
