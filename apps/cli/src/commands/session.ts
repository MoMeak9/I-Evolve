import { sendRequest } from '@i-evolve/daemon';
import { ensureDaemon } from './ensure-daemon.js';

export async function handleSessionCommand(
  subcommand: string | undefined,
  flags: Record<string, unknown>,
): Promise<void> {
  if (subcommand !== 'finalize') {
    console.error('Usage: i-evolve session finalize [--session <id>] [--auto-evolve]');
    process.exit(1);
  }

  const sessionId = (flags.session as string) ?? process.env.CLAUDE_SESSION_ID;
  if (!sessionId) {
    console.error('Warning: no session id provided; nothing to finalize.');
    return;
  }

  const { running } = await ensureDaemon();
  if (!running) {
    console.error('Warning: daemon not reachable, skipping finalize.');
    return;
  }

  try {
    const resp = await sendRequest({
      type: 'session.finalize',
      payload: { sessionId, autoEvolve: Boolean(flags['auto-evolve']) },
    });
    if (!resp.ok) {
      console.error(`Warning: finalize enqueue failed: ${resp.error?.message}`);
    }
  } catch {
    console.error('Warning: failed to reach daemon for finalize.');
  }
}
