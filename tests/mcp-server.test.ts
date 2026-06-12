import { describe, expect, it } from 'vitest';
import { createMcpHandlers, ensureDaemonRunning } from '../apps/mcp-server/src/server.js';
import type { DaemonClient } from '../apps/mcp-server/src/daemon-client.js';

function makeDaemon(overrides: Partial<DaemonClient> = {}): DaemonClient {
  return {
    health: async () => ({ ok: true, data: { status: 'running' } }),
    recall: async () => '# I-Evolve Context\n\n## Current Repository\n- repo_id: acme/editor\n',
    searchMemory: async () => [{ id: 'project.demo.fact', scope: 'project', confidence: 0.9, reason: 'project_id matched' }],
    auditMemory: async () => [{ id: 'audit.1', action: 'ai_approve', memoryId: 'project.demo.fact' }],
    explainMemory: async () => 'ai_approve by i-evolve-policy-v1',
    forget: async () => ({ auditId: 'audit.forget.1' }),
    syncMemory: async () => ({ message: 'pulled' }),
    remember: async () => ({ auditId: 'audit.remember.1' }),
    ...overrides,
  };
}

describe('mcp server handlers', () => {
  it('fails startup when daemon is not running', async () => {
    await expect(ensureDaemonRunning(makeDaemon({
      health: async () => ({ ok: false, error: { code: 'ERR_DAEMON_NOT_RUNNING', message: 'daemon down' } }),
    }))).rejects.toThrow(/daemon down/);
  });

  it('recall returns context and memory provenance', async () => {
    const handlers = createMcpHandlers(makeDaemon());
    const result = await handlers.recall({ query: 'SSR', cwd: '/tmp/repo', maxTokens: 2000 });
    expect(result.ok).toBe(true);
    expect(result.data.context).toContain('# I-Evolve Context');
    expect(result.data.memories[0].reason).toContain('project');
  });

  it('forget delegates to daemon client and returns audit id', async () => {
    const calls: unknown[] = [];
    const handlers = createMcpHandlers(makeDaemon({
      forget: async (input) => {
        calls.push(input);
        return { auditId: 'audit.forget.2' };
      },
    }));
    const result = await handlers.forget({ memoryId: 'project.demo.fact', mode: 'soft' });
    expect(calls).toEqual([{ memoryId: 'project.demo.fact', mode: 'soft' }]);
    expect(result.auditId).toBe('audit.forget.2');
  });

  it('search and explain expose readable memory context', async () => {
    const handlers = createMcpHandlers(makeDaemon());
    expect((await handlers.search_memory({ query: 'fact' })).data[0].id).toBe('project.demo.fact');
    expect((await handlers.explain_memory({ memoryId: 'project.demo.fact' })).data.explanation).toContain('ai_approve');
  });
});
