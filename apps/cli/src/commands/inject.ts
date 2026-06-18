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

// Emit the context markdown. With --hook, wrap it in the Claude Code SessionStart
// envelope so the output is folded into the model's context; otherwise print raw
// markdown for human/manual use.
function emitContext(md: string, hook: boolean): void {
  if (hook) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: md,
      },
    }));
  } else {
    console.log(md);
  }
}

export async function handleInject(flags: Record<string, unknown>): Promise<void> {
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

  const hook = Boolean(flags.hook);

  let repo: MarkdownMemoryRepository;
  try {
    repo = getRepo();
  } catch {
    // Fail-soft: empty context per MVP4 failure strategy.
    emitContext('# I-Evolve Context\n\n(no memories available)', hook);
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
    emitContext(md, hook);
  } catch {
    emitContext('# I-Evolve Context\n\n(retrieval failed)', hook);
  } finally {
    repo.close();
  }
}
