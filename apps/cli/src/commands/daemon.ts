import { Daemon, sendRequest, paths } from '@i-evolve/daemon';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export async function handleDaemonCommand(
  subcommand: string | undefined,
  opts: { foreground: boolean },
): Promise<void> {
  switch (subcommand) {
    case 'start':
      await startDaemon(opts.foreground);
      break;
    case 'stop':
      await stopDaemon();
      break;
    case 'status':
      await showStatus();
      break;
    case 'restart':
      await stopDaemon();
      await startDaemon(opts.foreground);
      break;
    default:
      console.error('Usage: i-evolve daemon <start|stop|status|restart>');
      process.exit(1);
  }
}

async function startDaemon(foreground: boolean): Promise<void> {
  if (foreground) {
    const daemon = new Daemon();
    await daemon.start();
    console.log(`Daemon started (pid ${process.pid}) in foreground mode.`);
    await new Promise(() => {}); // block forever
  } else {
    const entry = new URL('../../src/daemon-entry.js', import.meta.url).pathname;
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    // wait briefly and verify
    await new Promise((r) => setTimeout(r, 500));
    try {
      const resp = await sendRequest({ type: 'ping' });
      if (resp.ok) {
        console.log(`Daemon started (pid ${child.pid}).`);
      }
    } catch {
      console.log(`Daemon process spawned (pid ${child.pid}). Verifying...`);
    }
  }
}

async function stopDaemon(): Promise<void> {
  if (!existsSync(paths.runtime.pid)) {
    console.log('Daemon is not running.');
    return;
  }
  const pid = parseInt(readFileSync(paths.runtime.pid, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Daemon (pid ${pid}) stopped.`);
  } catch {
    console.log('Daemon process not found. Cleaning up stale files.');
    const { ProcessLock } = await import('@i-evolve/daemon');
    new ProcessLock().repair();
  }
}

async function showStatus(): Promise<void> {
  try {
    const resp = await sendRequest({ type: 'health' });
    if (resp.ok) {
      const data = resp.data as { status: string; startedAt: string; pid: number };
      console.log(`Daemon: ${data.status}`);
      console.log(`  PID: ${data.pid}`);
      console.log(`  Started: ${data.startedAt}`);
    }
  } catch {
    console.log('Daemon: stopped');
  }
}
