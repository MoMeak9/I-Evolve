import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import {
  MarkdownMemoryRepository,
  detectProjectIdentity,
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
  const detected = detectProjectIdentity({ cwd: process.cwd() });
  const ctx = {
    repoId: (flags['repo-id'] as string) ?? process.env.IEVOLVE_REPO_ID ?? detected.repoId,
    projectId: (flags['project-id'] as string) ?? process.env.IEVOLVE_PROJECT_ID ?? detected.projectId,
    domain: (flags.domain as string) ?? process.env.IEVOLVE_DOMAIN ?? detected.domain,
    packageNames: detected.packageNames,
  };

  let repo: MarkdownMemoryRepository;
  try {
    repo = getRepo();
  } catch {
    // Fail-soft: empty context per MVP4 failure strategy.
    console.log('# I-Evolve Context\n\n(no memories available)');
    return;
  }

  try {
    const debug = retrieveContextDebug(repo, ctx);
    if (flags.debug) {
      console.log(`Matched identity: repo=${ctx.repoId ?? 'unknown'}, project=${ctx.projectId ?? 'unknown'}`);
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
    console.log(md);
  } catch {
    console.log('# I-Evolve Context\n\n(retrieval failed)');
  } finally {
    repo.close();
  }
}
