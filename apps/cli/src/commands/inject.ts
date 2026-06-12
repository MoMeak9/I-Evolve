import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository, retrieveContext, formatContextMarkdown } from '@i-evolve/storage';

function getRepo(): MarkdownMemoryRepository {
  return new MarkdownMemoryRepository({
    memoryDir: paths.shared.memory,
    dbPath: join(paths.base, 'shared', 'index.db'),
  });
}

export async function handleInject(flags: Record<string, unknown>): Promise<void> {
  const ctx = {
    repoId: (flags['repo-id'] as string) ?? process.env.IEVOLVE_REPO_ID,
    projectId: (flags['project-id'] as string) ?? process.env.IEVOLVE_PROJECT_ID,
    domain: (flags.domain as string) ?? process.env.IEVOLVE_DOMAIN,
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
    const retrieved = retrieveContext(repo, ctx);
    const md = formatContextMarkdown(ctx, retrieved);
    console.log(md);
  } catch {
    console.log('# I-Evolve Context\n\n(retrieval failed)');
  } finally {
    repo.close();
  }
}
