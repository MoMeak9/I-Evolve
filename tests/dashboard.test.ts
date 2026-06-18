import { describe, expect, it } from 'vitest';
import { renderDashboard } from '../apps/dashboard/src/main.js';
import type { DashboardDaemonClient } from '../apps/dashboard/src/api/daemonClient.js';

describe('dashboard', () => {
  it('renders memory, audit, conflict, daemon, git, and settings data', async () => {
    const root = makeRoot();
    const client = makeClient();

    await renderDashboard(root, client);

    expect(root.textContent).toContain('repo.acme-demo.fact');
    expect(root.textContent).toContain('activate');
    expect(root.textContent).toContain('conflict.demo');
    expect(root.textContent).toContain('running');
    expect(root.textContent).toContain('main');
    expect(root.textContent).toContain('Local daemon only');
  });

  it('invokes forget, deprecate, and rollback actions through the daemon client', async () => {
    const calls: string[] = [];
    const root = makeRoot();
    const client = makeClient({
      forget: async (id, mode) => { calls.push(`forget:${id}:${mode}`); return {}; },
      deprecate: async (id) => { calls.push(`deprecate:${id}`); return {}; },
      rollback: async (commit) => { calls.push(`rollback:${commit}`); return {}; },
    });

    await renderDashboard(root, client);
    click(root, '[data-action="forget"]');
    click(root, '[data-action="deprecate"]');
    click(root, '[data-action="rollback"]');

    expect(calls).toEqual([
      'forget:repo.acme-demo.fact:soft',
      'deprecate:repo.acme-demo.fact',
      'rollback:abc123',
    ]);
  });
});

function makeRoot(): HTMLElement {
  return {
    innerHTML: '',
    textContent: '',
    listeners: new Map<string, EventListener>(),
    querySelector(selector: string) {
      if (selector === '#dashboard-panel') return this;
      return null;
    },
    querySelectorAll(selector: string) {
      const matches = [...this.innerHTML.matchAll(new RegExp(`<button([^>]*${selector.slice(1, -1)}[^>]*)>`, 'g'))];
      return matches.map((match) => ({
        getAttribute(name: string) {
          return new RegExp(`${name}="([^"]+)"`).exec(match[1])?.[1] ?? null;
        },
      }));
    },
    addEventListener(type: string, listener: EventListener) {
      this.listeners.set(type, listener);
    },
    dispatchEvent(event: any) {
      this.listeners.get(event.type)?.(event);
    },
  } as any;
}

function click(root: HTMLElement, selector: string): void {
  const action = selector.match(/data-action="(.+?)"/)?.[1] ?? selector.match(/\[data-action="(.+?)"\]/)?.[1];
  root.dispatchEvent({
    type: 'click',
    target: {
      closest: () => ({
        getAttribute: (name: string) => {
          if (name === 'data-action') return action;
          if (name === 'data-memory-id') return action === 'rollback' ? null : 'repo.acme-demo.fact';
          if (name === 'data-commit') return action === 'rollback' ? 'abc123' : null;
          return null;
        },
      }),
    },
  });
}

function makeClient(overrides: Partial<DashboardDaemonClient> = {}): DashboardDaemonClient {
  return {
    health: async () => ({ status: 'running' }),
    memories: async () => [{
      id: 'repo.acme-demo.fact',
      title: 'Demo Fact',
      scope: 'repo',
      status: 'active',
      confidence: 0.9,
      revision: 1,
      expiresAt: null,
      content: 'Demo memory content',
    }],
    audit: async () => [{ id: 'audit.1', memoryId: 'repo.acme-demo.fact', action: 'activate', reason: 'approved' }],
    conflicts: async () => [{ id: 'conflict.demo', selectedMemoryId: 'repo.acme-demo.fact', suppressedMemoryIds: [] }],
    gitStatus: async () => ({ initialized: true, branch: 'main', commit: 'abc123', clean: true }),
    forget: async () => ({}),
    deprecate: async () => ({}),
    rollback: async () => ({}),
    ...overrides,
  };
}
