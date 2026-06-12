import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMcpHandlers, ensureDaemonRunning } from '../apps/mcp-server/src/server.js';
import type { DaemonClient } from '../apps/mcp-server/src/daemon-client.js';
import { Daemon } from '../packages/daemon/src/daemon.js';
import { setBasePath, paths } from '../packages/daemon/src/paths.js';
import { MarkdownMemoryRepository } from '../packages/storage/src/memory-repository.js';

let child: ChildProcessWithoutNullStreams | undefined;

afterEach(() => {
  child?.kill('SIGTERM');
  child = undefined;
});

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

describe('mcp stdio transport', () => {
  it('starts over stdio and calls recall through daemon IPC', async () => {
    const baseDir = join('/tmp', `ie-mcp-${randomBytes(4).toString('hex')}`);
    setBasePath(baseDir);
    mkdirSync(paths.shared.dir, { recursive: true });
    const repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });
    repo.create({
      id: 'project.demo.mcp-recall',
      type: 'project_fact',
      scope: 'project',
      projectId: 'demo',
      title: 'MCP Recall',
      content: 'MCP clients recall daemon-backed project memory.',
      status: 'active',
      visibility: 'team',
      confidence: 0.93,
      ttlDays: 90,
      tags: ['mcp'],
      sourceRefs: [],
    });
    repo.close();

    const daemon = new Daemon();
    await daemon.start();
    try {
      child = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', 'mcp', 'start', '--stdio'], {
        cwd: process.cwd(),
        env: { ...process.env, IEVOLVE_BASE_PATH: baseDir },
      });
      const rpc = createJsonRpcClient(child);
      const initialized = await rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });
      expect(initialized.result.serverInfo.name).toBe('i-evolve');

      const tools = await rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      expect(tools.result.tools.map((tool: any) => tool.name)).toContain('recall');

      const recalled = await rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'recall',
          arguments: { query: 'MCP clients', cwd: baseDir, projectId: 'demo' },
        },
      });
      expect(recalled.result.content[0].text).toContain('daemon-backed project memory');
    } finally {
      child?.kill('SIGTERM');
      child = undefined;
      await daemon.stop();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

function createJsonRpcClient(proc: ChildProcessWithoutNullStreams) {
  let buffer = '';
  const pending = new Map<number, (value: any) => void>();
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!raw.trim()) continue;
      const message = JSON.parse(raw);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  return (message: any) => new Promise<any>((resolve, reject) => {
    pending.set(message.id, resolve);
    proc.stdin.write(JSON.stringify(message) + '\n');
    setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}`)), 3000);
  });
}
