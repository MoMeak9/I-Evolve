import { dirname, join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { paths } from '@i-evolve/daemon';
import type { AuditAction } from '@i-evolve/core';
import { GitMemorySync } from '@i-evolve/git-sync';
import { MarkdownMemoryRepository } from '@i-evolve/storage';

function getSync(): GitMemorySync {
  return new GitMemorySync(paths.shared.memory);
}

function rebuildIndexAfterGitChange(): void {
  const repo = new MarkdownMemoryRepository({
    memoryDir: paths.shared.memory,
    dbPath: join(paths.base, 'shared', 'index.db'),
  });
  const { total, errors } = repo.rebuildIndex();
  repo.close();
  console.log(`Index rebuilt: ${total} memories, ${errors} errors.`);
}

function appendSyncAudit(action: AuditAction): void {
  const dir = dirname(paths.audit.current);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(action) + '\n';
  appendFileSync(paths.audit.current, line, 'utf-8');
}

function gitChangeHooks() {
  return {
    rebuildIndex: rebuildIndexAfterGitChange,
    appendAudit: appendSyncAudit,
  };
}

export async function handleRemoteCommand(subcommand: string | undefined, args: string[], flags: Record<string, unknown>): Promise<void> {
  switch (subcommand) {
    case 'init': {
      const url = args[0];
      if (!url) { console.error('Error: git url required'); process.exit(1); }
      const dir = paths.shared.memory;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      GitMemorySync.clone(url, dir);
      console.log(`Cloned remote memory repo into ${dir}`);
      break;
    }
    case 'status': {
      const sync = getSync();
      if (!sync.isInitialized()) { console.error('Remote not initialized. Run: i-evolve memory remote init <url>'); process.exit(1); }
      const s = sync.status();
      console.log(`branch: ${s.branch}`);
      console.log(`commit: ${s.commit}`);
      console.log(`clean: ${s.clean}`);
      break;
    }
    case 'pull': {
      const result = await getSync().pull(gitChangeHooks());
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }
    case 'push': {
      const result = await getSync().push({ appendAudit: appendSyncAudit });
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }
    case 'commit': {
      const message = (flags.message as string) ?? 'memory(auto): update';
      const result = await getSync().commit({ message });
      console.log(result.message + (result.commit ? ` (${result.commit.slice(0, 8)})` : ''));
      break;
    }
    case 'checkout': {
      const ref = args[0];
      if (!ref) { console.error('Error: commit/tag required'); process.exit(1); }
      const result = await getSync().checkout(ref, gitChangeHooks());
      console.log(result.message);
      break;
    }
    case 'rollback': {
      const toCommit = flags['to-commit'] as string | undefined;
      if (!toCommit) { console.error('Error: --to-commit required'); process.exit(1); }
      const mode = (flags.mode as 'checkout' | 'revert') ?? 'checkout';
      const result = await getSync().rollback({ toCommit, mode, ...gitChangeHooks() });
      console.log(result.message);
      break;
    }
    case 'log': {
      console.log(getSync().log());
      break;
    }
    case 'validate': {
      const report = getSync().validate();
      console.log(`Checked ${report.checkedFiles} file(s): ${report.ok ? 'OK' : `${report.issues.length} issue(s)`}`);
      for (const issue of report.issues) {
        console.log(`  ${issue.file}: ${issue.problem}`);
      }
      if (!report.ok) process.exit(1);
      break;
    }
    default:
      console.error('Usage: i-evolve memory remote <init|status|pull|push|commit|checkout|rollback|log|validate>');
      process.exit(1);
  }
}
