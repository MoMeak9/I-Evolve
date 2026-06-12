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
