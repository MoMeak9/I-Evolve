import { existsSync, readFileSync } from 'node:fs';

export interface SyncConfig {
  autoPush: boolean;
}

export function readSyncConfig(packPath: string): SyncConfig {
  if (!existsSync(packPath)) return { autoPush: false };
  const raw = readFileSync(packPath, 'utf-8');
  const match = raw.match(/auto_push:\s*(true|false)/);
  return { autoPush: match?.[1] === 'true' };
}
