import { LocalDaemonHttpClient } from './api/daemonClient.js';
import type { DashboardDaemonClient } from './api/daemonClient.js';

const sections = [
  'Memories',
  'Memory Detail',
  'Audit',
  'Conflicts',
  'Daemon Status',
  'Git Status',
  'Settings',
];

export async function renderDashboard(root: HTMLElement, client: DashboardDaemonClient = new LocalDaemonHttpClient()): Promise<void> {
  root.innerHTML = `
    <main class="app-shell">
      <aside class="sidebar">
        <h1>I-Evolve</h1>
        <nav>${sections.map((s) => `<button data-view="${s}">${s}</button>`).join('')}</nav>
      </aside>
      <section class="content">
        <header>
          <h2>Memories</h2>
          <p>Local daemon dashboard for memory governance, audit, conflicts, and Git state.</p>
        </header>
        <div id="dashboard-panel" class="panel">Loading local daemon status...</div>
      </section>
    </main>
  `;

  const panel = root.querySelector('#dashboard-panel');
  try {
    const [health, memories, audit, conflicts, git] = await Promise.all([
      client.health(),
      client.memories(),
      client.audit(),
      client.conflicts(),
      client.gitStatus(),
    ]);
    if (panel) {
      panel.innerHTML = renderPanel({ health, memories, audit, conflicts, git });
      panel.textContent = stripHtml(panel.innerHTML);
    }
  } catch {
    if (panel) panel.textContent = 'Daemon bridge unavailable. Start the local daemon bridge before using actions.';
  }

  root.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest?.('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const memoryId = button.getAttribute('data-memory-id');
    const commit = button.getAttribute('data-commit');
    if (action === 'forget' && memoryId) await client.forget(memoryId, 'soft');
    if (action === 'deprecate' && memoryId) await client.deprecate(memoryId);
    if (action === 'rollback' && commit) await client.rollback(commit);
  });
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) renderDashboard(root);
}

function renderPanel(data: {
  health: unknown;
  memories: any[];
  audit: any[];
  conflicts: any[];
  git: any;
}): string {
  const commit = data.git?.commit ?? '';
  return `
    <section class="dashboard-grid">
      <article>
        <h3>Memories</h3>
        <table>
          <tbody>${data.memories.map((m) => `
            <tr>
              <td>${escapeHtml(m.id)}</td>
              <td>${escapeHtml(m.status)}</td>
              <td>${escapeHtml(m.scope)}</td>
              <td>${m.confidence}</td>
              <td>
                <button data-action="forget" data-memory-id="${escapeHtml(m.id)}">Forget</button>
                <button data-action="deprecate" data-memory-id="${escapeHtml(m.id)}">Deprecate</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </article>
      <article><h3>Audit</h3><pre>${escapeHtml(JSON.stringify(data.audit, null, 2))}</pre></article>
      <article><h3>Conflicts</h3><pre>${escapeHtml(JSON.stringify(data.conflicts, null, 2))}</pre></article>
      <article><h3>Daemon Status</h3><pre>${escapeHtml(JSON.stringify(data.health, null, 2))}</pre></article>
      <article>
        <h3>Git Status</h3>
        <pre>${escapeHtml(JSON.stringify(data.git, null, 2))}</pre>
        <button data-action="rollback" data-commit="${escapeHtml(commit)}">Rollback</button>
      </article>
      <article><h3>Settings</h3><p>Local daemon only. No direct Markdown or Git writes.</p></article>
    </section>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}
