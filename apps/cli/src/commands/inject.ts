import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import {
  MarkdownMemoryRepository,
  detectRepoIdentity,
  retrieveContext,
  retrieveContextDebug,
  formatContextMarkdown,
} from '@i-evolve/storage';

function getRepo(): MarkdownMemoryRepository {
  return new MarkdownMemoryRepository({
    memoryDir: paths.shared.memory,
    dbPath: join(paths.base, 'shared', 'index.db'),
  });
}

export async function handleInject(flags: Record<string, unknown>): Promise<void> {
  // When invoked as a Claude Code SessionStart hook (--hook), wrap the markdown
  // in the {"hookSpecificOutput":{...}} envelope Claude Code requires; raw stdout
  // is otherwise silently dropped instead of folded into the model context.
  const emit = (md: string): void => {
    if (flags.hook) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: md,
        },
      }));
    } else {
      console.log(md);
    }
  };

  // Auto-start the daemon so SessionStart context is available on first run.
  const { ensureDaemon } = await import('./ensure-daemon.js');
  await ensureDaemon();

  // Prefer the caller's real cwd (preserved by the launcher) over process.cwd(),
  // which the `pnpm -C` launcher pins to IEVOLVE_HOME and would otherwise misdetect
  // the repo as the I-Evolve checkout itself.
  const invocationCwd = process.env.IEVOLVE_INVOCATION_CWD ?? process.cwd();
  const detected = detectRepoIdentity({ cwd: invocationCwd });
  const ctx = {
    repoId: (flags['repo-id'] as string) ?? process.env.IEVOLVE_REPO_ID ?? detected.repoId,
    domain: (flags.domain as string) ?? process.env.IEVOLVE_DOMAIN ?? detected.domain,
    packageNames: detected.packageNames,
  };

  let repo: MarkdownMemoryRepository;
  try {
    repo = getRepo();
  } catch {
    // Fail-soft: empty context per MVP4 failure strategy.
    emit('# I-Evolve Context\n\n(no memories available)');
    return;
  }

  try {
    const debug = retrieveContextDebug(repo, ctx);
    if (flags.debug) {
      console.log(`Matched identity: repo=${ctx.repoId ?? 'unknown'}, domain=${ctx.domain ?? 'unknown'}`);
      console.log(`Candidates: ${debug.stats.candidates}`);
      console.log(`Filtered expired: ${debug.stats.filteredExpired}`);
      console.log(`Filtered scope mismatch: ${debug.stats.filteredScopeMismatch}`);
      console.log(`Filtered deprecated: ${debug.stats.filteredDeprecated}`);
      console.log(`Injected: ${debug.stats.injected}`);
      console.log(`Suppressed conflicts: ${debug.stats.suppressedConflicts}`);
      console.log('');
    }
    const retrieved = flags.debug ? debug.retrieved : retrieveContext(repo, ctx);
    const md = formatContextMarkdown(ctx, retrieved);
    emit(md);
  } catch {
    emit('# I-Evolve Context\n\n(retrieval failed)');
  } finally {
    repo.close();
  }
}
