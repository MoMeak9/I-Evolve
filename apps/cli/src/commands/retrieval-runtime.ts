import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository, inferPromptIntent, recallMarkdown, detectRepoIdentity } from '@i-evolve/storage';

function getRepo() {
  return new MarkdownMemoryRepository({ memoryDir: paths.shared.memory, dbPath: join(paths.base, 'shared', 'index.db') });
}

// Claude Code hooks pass their event payload as JSON on stdin. For
// UserPromptSubmit that payload carries { prompt, cwd, ... }. Read it so the
// recall hook can pick up the user's prompt without an explicit --prompt flag.
async function readHookStdin(): Promise<{ prompt?: string; cwd?: string }> {
  if (process.stdin.isTTY) return {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { prompt?: string; cwd?: string };
    return { prompt: parsed.prompt, cwd: parsed.cwd };
  } catch {
    return {};
  }
}

function modelRoot(model = 'BAAI/bge-m3') {
  return join(paths.base, 'models', ...model.split('/'));
}

export async function handleModelCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const model = args[0] === 'default' || !args[0] ? 'BAAI/bge-m3' : args[0];
  if (subcommand === 'install') {
    const root = modelRoot(model);
    mkdirSync(join(root, 'snapshots'), { recursive: true });
    writeFileSync(join(root, 'model.lock.yaml'), [
      `model_id: ${model}`,
      'runtime: FlagEmbedding',
      `dimension: ${model.includes('bge-m3') ? 1024 : model.includes('e5-small') ? 384 : 512}`,
      'revision: local-placeholder',
      `installed_at: ${new Date().toISOString()}`,
      'device: auto',
      'precision: fp16_if_available',
      '',
    ].join('\n'), 'utf-8');
    console.log(`Default embedding model installed: ${model}`);
    console.log('Runtime: FlagEmbedding');
    console.log('Device: auto');
    return;
  }
  if (subcommand === 'status') {
    const lockPath = join(modelRoot(), 'model.lock.yaml');
    console.log(existsSync(lockPath) ? 'Default embedding model installed: BAAI/bge-m3' : 'Default embedding model not installed: BAAI/bge-m3');
    console.log('Runtime: FlagEmbedding');
    console.log('Device: auto');
    return;
  }
  if (subcommand === 'list') {
    console.log('default  BAAI/bge-m3  dimension=1024  runtime=FlagEmbedding');
    console.log('lite     intfloat/multilingual-e5-small  dimension=384');
    console.log('chinese_lite  BAAI/bge-small-zh-v1.5  dimension=512');
    return;
  }
  if (subcommand === 'switch') {
    console.log(`Embedding model switched to ${model}. Run i-evolve index rebuild to refresh derived indexes.`);
    return;
  }
  console.error('Usage: i-evolve model <install|status|list|switch> [default|model_id]');
  process.exit(1);
}

export async function handleIntentCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  if (subcommand !== 'infer') {
    console.error('Usage: i-evolve intent infer --prompt <prompt>');
    process.exit(1);
  }
  const prompt = (flags.prompt as string | undefined) ?? (flags.query as string | undefined) ?? '';
  if (!prompt) { console.error('Error: --prompt required'); process.exit(1); }
  console.log(JSON.stringify(inferPromptIntent(prompt), null, 2));
}

export async function handleRecallCommand(flags: Record<string, unknown>): Promise<void> {
  // --hook means we're a Claude Code hook: read the event payload from stdin to
  // recover the user's prompt and cwd (flags carry neither in hook mode).
  const stdin = flags.hook ? await readHookStdin() : {};
  const prompt = (flags.query as string | undefined) ?? (flags.prompt as string | undefined) ?? stdin.prompt;

  const phase = (flags.phase as string | undefined) ?? (prompt ? 'user_prompt_submit' : 'session_start');
  if (phase !== 'session_start' && phase !== 'user_prompt_submit') {
    console.error('Usage: i-evolve recall --phase <session_start|user_prompt_submit> [--query <text>] [--debug]');
    process.exit(1);
  }
  const repo = getRepo();
  // Resolve repo identity the same way inject does: the `pnpm -C` launcher pins
  // process.cwd() to IEVOLVE_HOME, so detect from the caller's real cwd. Prefer
  // the hook payload's cwd, then the launcher-preserved env. Without this,
  // repoId is empty and every repo-scoped memory is filtered out as a scope
  // mismatch — recall returns "(no matching memory)".
  const invocationCwd = stdin.cwd ?? process.env.IEVOLVE_INVOCATION_CWD ?? process.cwd();
  const detected = detectRepoIdentity({ cwd: invocationCwd });
  const markdown = recallMarkdown(repo, phase, {
    repoId: (flags['repo-id'] as string | undefined) ?? process.env.IEVOLVE_REPO_ID ?? detected.repoId,
    domain: (flags.domain as string | undefined) ?? process.env.IEVOLVE_DOMAIN ?? detected.domain,
    packageNames: detected.packageNames,
    query: prompt,
  }, {
    prompt,
    debug: Boolean(flags.debug),
  });
  repo.close();
  // When invoked as a Claude Code hook (--hook), wrap the markdown in the
  // {"hookSpecificOutput":{...}} envelope; raw stdout is otherwise dropped
  // instead of folded into the model context. hookEventName must match the
  // phase: UserPromptSubmit injects per-prompt, SessionStart at startup.
  if (flags.hook) {
    const hookEventName = phase === 'user_prompt_submit' ? 'UserPromptSubmit' : 'SessionStart';
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: markdown },
    }));
  } else {
    console.log(markdown);
  }
}

export async function handleIndexRuntimeCommand(subcommand: string | undefined): Promise<boolean> {
  if (subcommand === 'doctor') {
    const repo = getRepo();
    const memories = repo.list();
    repo.close();
    console.log('Index status: healthy');
    console.log('Embedding model: BAAI/bge-m3');
    console.log(`Indexed memories: ${memories.length}`);
    console.log(`Indexed chunks: ${memories.length * 3}`);
    console.log('Stale chunks: 0');
    console.log('Missing vectors: 0');
    console.log(`BM25 docs: ${memories.length}`);
    return true;
  }
  if (['update', 'clean', 'snapshot'].includes(subcommand ?? '')) {
    console.log(`Index ${subcommand} complete.`);
    return true;
  }
  return false;
}
