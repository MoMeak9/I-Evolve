import { sendRequest } from '@i-evolve/daemon';
import { ensureDaemon } from './ensure-daemon.js';

/**
 * Reads hook payload JSON from stdin if available (non-TTY).
 * Claude Code hooks pass event data on stdin (same as observe).
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8').trim();
}

/** 取 sessionId 的优先级:--session flag → CLAUDE_SESSION_ID → hook stdin 的 session_id。 */
export function resolveSessionId(
  flagSession: string | undefined,
  envSession: string | undefined,
  hookData: unknown,
): string | undefined {
  if (flagSession) return flagSession;
  if (envSession) return envSession;
  if (hookData && typeof hookData === 'object') {
    const sid = (hookData as Record<string, unknown>).session_id;
    if (typeof sid === 'string' && sid) return sid;
  }
  return undefined;
}

export async function handleSessionCommand(
  subcommand: string | undefined,
  flags: Record<string, unknown>,
): Promise<void> {
  if (subcommand !== 'finalize') {
    console.error('Usage: i-evolve session finalize [--session <id>] [--auto-evolve]');
    process.exit(1);
  }

  let hookData: Record<string, unknown> = {};
  const stdin = await readStdin();
  if (stdin) {
    try { hookData = JSON.parse(stdin); } catch { /* tolerate non-JSON stdin */ }
  }

  const sessionId = resolveSessionId(
    flags.session as string | undefined,
    process.env.CLAUDE_SESSION_ID,
    hookData,
  );
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
