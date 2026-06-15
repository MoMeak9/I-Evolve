import { spawn } from 'node:child_process';
import { sendRequest } from '@i-evolve/daemon';

export interface EnsureDaemonResult {
  running: boolean;
  started: boolean;
}

async function ping(): Promise<boolean> {
  try {
    const resp = await sendRequest({ type: 'ping' });
    return Boolean(resp.ok);
  } catch {
    return false;
  }
}

/**
 * Ensure the daemon is running, auto-starting it in the background if needed.
 *
 * Fail-soft: if the spawn or verification fails, returns { running: false }
 * rather than throwing, so callers in non-interactive hooks never block.
 *
 * The daemon-entry path mirrors commands/daemon.ts so both resolve identically
 * under tsx source execution (the documented run mode).
 */
export async function ensureDaemon(): Promise<EnsureDaemonResult> {
  if (await ping()) return { running: true, started: false };

  const entry = new URL('../../src/daemon-entry.js', import.meta.url).pathname;
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
  } catch {
    return { running: false, started: false };
  }

  // Poll briefly for readiness.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping()) return { running: true, started: true };
  }
  return { running: false, started: true };
}
