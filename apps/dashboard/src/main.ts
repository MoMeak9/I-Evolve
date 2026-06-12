import { LocalDaemonHttpClient } from './api/daemonClient.js';

const sections = [
  'Memories',
  'Memory Detail',
  'Audit',
  'Conflicts',
  'Daemon Status',
  'Git Status',
  'Settings',
];

export function renderDashboard(root: HTMLElement): void {
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
  const client = new LocalDaemonHttpClient();
  client.health()
    .then((health) => {
      if (panel) panel.textContent = JSON.stringify(health, null, 2);
    })
    .catch(() => {
      if (panel) panel.textContent = 'Daemon bridge unavailable. Start the local daemon bridge before using actions.';
    });
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) renderDashboard(root);
}
