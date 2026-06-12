import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { MarkdownMemoryRepository } from '@i-evolve/storage';
import { paths } from '@i-evolve/daemon';
import { parseMemoryMarkdown } from '@i-evolve/storage';
import { mapKeysSnakeToCamel } from '@i-evolve/schema';
import type { MemoryItem } from '@i-evolve/core';
import type { MemoryStatus } from '@i-evolve/shared';

function getRepo() {
  const memoryDir = paths.shared.memory;
  const dbPath = join(paths.base, 'shared', 'index.db');
  return new MarkdownMemoryRepository({ memoryDir, dbPath });
}

export async function handleMemoryCommand(subcommand: string | undefined, args: string[], flags: Record<string, unknown>): Promise<void> {
  switch (subcommand) {
    case 'remote': {
      const { handleRemoteCommand } = await import('./remote.js');
      await handleRemoteCommand(args[0], args.slice(1), flags);
      break;
    }
    case 'init-local': {
      const repo = getRepo();
      repo.close();
      console.log('Memory repository initialized.');
      break;
    }
    case 'add': {
      const file = flags.file as string | undefined;
      if (!file) { console.error('Error: --file required'); process.exit(1); }
      const raw = readFileSync(file, 'utf-8');
      const { frontmatter, content } = parseMemoryMarkdown(raw);
      const camel = mapKeysSnakeToCamel(frontmatter) as unknown as MemoryItem;
      const repo = getRepo();
      const memory = repo.create({ ...camel, content });
      repo.close();
      console.log(`Created: ${memory.id} (rev ${memory.revision})`);
      break;
    }
    case 'get': {
      const id = args[0];
      if (!id) { console.error('Error: memory id required'); process.exit(1); }
      const repo = getRepo();
      const memory = repo.get(id);
      repo.close();
      if (!memory) { console.error(`Not found: ${id}`); process.exit(1); }
      console.log(JSON.stringify(memory, null, 2));
      break;
    }
    case 'list': {
      const repo = getRepo();
      const memories = repo.list({ status: (flags.status as string) ?? 'active' });
      repo.close();
      for (const m of memories) {
        console.log(`[${m.status}] ${m.id} — ${m.title}`);
      }
      if (memories.length === 0) console.log('(no memories)');
      break;
    }
    case 'search': {
      const query = args[0];
      if (!query) { console.error('Error: search query required'); process.exit(1); }
      const repo = getRepo();
      const results = repo.search(query);
      repo.close();
      for (const r of results) {
        console.log(`[${r.rank.toFixed(2)}] ${r.memory.id} — ${r.memory.title}`);
      }
      if (results.length === 0) console.log('(no results)');
      break;
    }
    case 'status': {
      const id = args[0];
      const newStatus = args[1] as MemoryStatus | undefined;
      if (!id || !newStatus) { console.error('Usage: i-evolve memory status <id> <new-status>'); process.exit(1); }
      const repo = getRepo();
      const current = repo.get(id);
      if (!current) { repo.close(); console.error(`Not found: ${id}`); process.exit(1); }
      const updated = repo.changeStatus(id, newStatus, { expectedRevision: current.revision });
      repo.close();
      console.log(`Status changed: ${id} → ${updated.status} (rev ${updated.revision})`);
      break;
    }
    case 'forget': {
      const id = args[0];
      const mode = (flags.mode as string) ?? 'soft';
      if (!id) { console.error('Error: memory id required'); process.exit(1); }
      const repo = getRepo();
      repo.forget(id, mode as 'soft' | 'tombstone');
      repo.close();
      console.log(`Forgot: ${id} (mode: ${mode})`);
      break;
    }
    default:
      console.error('Usage: i-evolve memory <init-local|add|get|list|search|status|forget>');
      process.exit(1);
  }
}

export async function handleIndexCommand(subcommand: string | undefined): Promise<void> {
  if (subcommand !== 'rebuild') {
    console.error('Usage: i-evolve index rebuild');
    process.exit(1);
  }
  const repo = getRepo();
  const { total, errors } = repo.rebuildIndex();
  repo.close();
  console.log(`Index rebuilt: ${total} memories indexed, ${errors} errors.`);
}
