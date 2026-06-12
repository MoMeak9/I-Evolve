import { createInterface } from 'node:readline';
import type { DaemonClient, McpMemoryRef } from './daemon-client.js';
import { IpcDaemonClient } from './daemon-client.js';

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

export async function runMcpStdio(client: DaemonClient = new IpcDaemonClient()): Promise<void> {
  await ensureDaemonRunning(client);
  const handlers = createMcpHandlers(client);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const response = await handleJsonRpcLine(line, handlers);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}

export async function handleJsonRpcLine(raw: string, handlers = createMcpHandlers(new IpcDaemonClient())): Promise<unknown> {
  let request: any;
  try {
    request = JSON.parse(raw);
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }
  try {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'i-evolve', version: '0.0.0' },
            capabilities: { tools: {} },
          },
        };
      case 'tools/list':
        return { jsonrpc: '2.0', id: request.id, result: { tools: MCP_TOOLS } };
      case 'tools/call':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: await callTool(handlers, request.params?.name, request.params?.arguments ?? {}),
        };
      case 'notifications/initialized':
        return undefined;
      default:
        return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
    }
  } catch (err) {
    return jsonRpcError(request.id, -32000, err instanceof Error ? err.message : String(err), {
      code: (err as any)?.code,
    });
  }
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

const MCP_TOOLS = [
  {
    name: 'recall',
    description: 'Recall I-Evolve memory context for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        cwd: { type: 'string' },
        maxTokens: { type: 'number' },
      },
      required: ['cwd'],
    },
  },
  { name: 'remember', description: 'Remember durable project knowledge.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, cwd: { type: 'string' } }, required: ['content'] } },
  { name: 'forget', description: 'Forget a memory by id.', inputSchema: { type: 'object', properties: { memoryId: { type: 'string' }, mode: { enum: ['soft', 'tombstone'] } }, required: ['memoryId'] } },
  { name: 'search_memory', description: 'Search active memories.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'audit_memory', description: 'Read memory audit records.', inputSchema: { type: 'object', properties: { memoryId: { type: 'string' } } } },
  { name: 'explain_memory', description: 'Explain a memory and its audit trail.', inputSchema: { type: 'object', properties: { memoryId: { type: 'string' } }, required: ['memoryId'] } },
  { name: 'sync_memory', description: 'Run memory sync action.', inputSchema: { type: 'object', properties: { action: { enum: ['pull', 'push', 'status'] } }, required: ['action'] } },
];

async function callTool(handlers: ReturnType<typeof createMcpHandlers>, name: string, args: any): Promise<unknown> {
  const fn = (handlers as any)[name];
  if (!fn) throw new Error(`Unknown tool: ${name}`);
  const result = await fn(args);
  return {
    content: [
      {
        type: 'text',
        text: typeof result?.data?.context === 'string'
          ? result.data.context
          : JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

if (process.argv[1]?.endsWith('server.js')) {
  runMcpStdio().catch((err) => {
    process.stdout.write(JSON.stringify(jsonRpcError(null, -32000, err instanceof Error ? err.message : String(err))) + '\n');
    process.exit(1);
  });
}
