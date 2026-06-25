import { existsSync, readFileSync } from 'node:fs';

export interface SyncConfig {
  autoPush: boolean;
  pushRepos: string[];
}

export function readSyncConfig(packPath: string): SyncConfig {
  const envRepos = process.env.IEVOLVE_PUSH_REPOS;
  if (envRepos && envRepos.length > 0) {
    const autoPush = readAutoPush(packPath);
    return { autoPush, pushRepos: envRepos.split(',').map((s) => s.trim()).filter(Boolean) };
  }

  if (!existsSync(packPath)) return { autoPush: false, pushRepos: [] };
  const raw = readFileSync(packPath, 'utf-8');
  const autoPush = /auto_push:\s*true/.test(raw);
  const repos: string[] = [];
  const block = raw.match(/push_repos:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (block) {
    for (const m of block[1].matchAll(/^\s+-\s+(.+)$/gm)) {
      repos.push(m[1].trim());
    }
  }
  return { autoPush, pushRepos: repos };
}

function readAutoPush(packPath: string): boolean {
  if (!existsSync(packPath)) return false;
  const raw = readFileSync(packPath, 'utf-8');
  return /auto_push:\s*true/.test(raw);
}
