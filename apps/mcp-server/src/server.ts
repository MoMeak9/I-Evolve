import type { DaemonClient, McpMemoryRef } from './daemon-client.js';

export interface McpResponse<T> {
  ok: boolean;
  data: T;
  warnings: string[];
  auditId?: string;
}

export function createMcpHandlers(client: DaemonClient) {
  return {
    recall: async (input: { query?: string; cwd: string; maxTokens?: number }) => {
      const context = await client.recall(input);
      const memories = await client.searchMemory({ query: input.query ?? '' });
      return ok({ context, memories });
    },
    remember: async (input: { content: string; cwd?: string }) => {
      const result = await client.remember(input);
      return ok(result, result.auditId);
    },
    forget: async (input: { memoryId: string; mode?: 'soft' | 'tombstone' }) => {
      return client.forget(input);
    },
    search_memory: async (input: { query: string }): Promise<McpResponse<McpMemoryRef[]>> => {
      return ok(await client.searchMemory(input));
    },
    audit_memory: async (input: { memoryId?: string }) => {
      return ok(await client.auditMemory(input));
    },
    explain_memory: async (input: { memoryId: string }) => {
      return ok({ explanation: await client.explainMemory(input) });
    },
    sync_memory: async (input: { action: 'pull' | 'push' | 'status' }) => {
      return ok(await client.syncMemory(input));
    },
  };
}

export async function ensureDaemonRunning(client: Pick<DaemonClient, 'health'>): Promise<void> {
  const health = await client.health();
  if (!health.ok) {
    throw new Error(health.error?.message ?? 'I-Evolve daemon is not running.');
  }
}

function ok<T>(data: T, auditId?: string): McpResponse<T> {
  return { ok: true, data, warnings: [], auditId };
}
