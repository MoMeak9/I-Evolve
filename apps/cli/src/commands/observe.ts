import { randomUUID } from 'node:crypto';
import { sendRequest, DaemonNotRunningError } from '@i-evolve/daemon';
import type { Observation } from '@i-evolve/core';
import type { ObservationPhase, ObservationSource } from '@i-evolve/shared';

interface ObserveFlags {
  phase?: string;
  source?: string;
  tool?: string;
  summary?: string;
  sessionId?: string;
}

/**
 * Reads hook payload JSON from stdin if available (non-TTY).
 * Claude Code hooks pass event data on stdin.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8').trim();
}

function buildObservationFromHook(hookData: Record<string, unknown>, flags: ObserveFlags): Observation {
  const toolName = flags.tool ?? (hookData.tool_name as string) ?? undefined;
  const toolInput = hookData.tool_input as Record<string, unknown> | undefined;
  const filePath = toolInput?.file_path as string | undefined;
  const command = toolInput?.command as string | undefined;

  const filesTouched = filePath ? [filePath] : undefined;
  const commands = command ? [command] : undefined;
  const summary =
    flags.summary ??
    (toolName ? `${toolName}${filePath ? ` ${filePath}` : ''}` : 'agent activity');

  return {
    id: `obs.${randomUUID()}`,
    timestamp: new Date().toISOString(),
    sessionId: flags.sessionId ?? (hookData.session_id as string) ?? 'unknown',
    source: (flags.source as ObservationSource) ?? 'claude-code',
    phase: (flags.phase as ObservationPhase) ?? 'post_tool_use',
    tool: toolName,
    summary,
    filesTouched,
    commands,
    status: 'success',
    sensitivity: 'internal',
  };
}

export async function handleObserve(jsonArg: string | undefined, flags: ObserveFlags = {}): Promise<void> {
  let payload: Observation;

  if (jsonArg) {
    try {
      payload = JSON.parse(jsonArg) as Observation;
    } catch {
      console.error('Error: invalid JSON');
      process.exit(1);
    }
  } else {
    const stdin = await readStdin();
    let hookData: Record<string, unknown> = {};
    if (stdin) {
      try { hookData = JSON.parse(stdin); } catch { /* tolerate non-JSON stdin */ }
    }
    payload = buildObservationFromHook(hookData, flags);
  }

  try {
    const resp = await sendRequest({ type: 'observe', payload });
    if (resp.ok) {
      console.log(`Observation appended: ${(resp.data as { id: string }).id}`);
    } else {
      console.error(`Warning: observe failed: ${resp.error?.message}`);
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.error('Warning: i-evolve daemon not running; observation skipped.');
      return;
    }
    console.error(`Warning: observe error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
