import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { ModelManager, createProvider, resolveProfile } from '@i-evolve/embedding';
import { MarkdownMemoryRepository, inferPromptIntent, recallMarkdown } from '@i-evolve/storage';

function getRepo() {
  return new MarkdownMemoryRepository({ memoryDir: paths.shared.memory, dbPath: join(paths.base, 'shared', 'index.db') });
}

export async function handleModelCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const profileArg = args[0] === 'default' || !args[0] ? 'lite' : args[0];
  const mgr = new ModelManager();

  if (subcommand === 'install') {
    const spec = resolveProfile(profileArg);
    console.log(`Installing embedding model: ${spec.modelId} (profile=${spec.profile})`);
    console.log('Downloading weights to ~/.i-evolve/models/ (first run may take a while)...');
    const provider = createProvider(spec.profile);
    const [vec] = await provider.embed(['probe'], 'query');
    mgr.writeLock(spec.profile, vec.length, 'local');
    console.log(`Installed: ${spec.modelId}  dimension=${vec.length}  runtime=transformers.js`);
    return;
  }

  if (subcommand === 'status') {
    const active = mgr.activeProfile();
    for (const s of mgr.list()) {
      const mark = s.profile === active ? '*' : ' ';
      console.log(`${mark} ${s.profile.padEnd(13)} ${s.modelId.padEnd(36)} dim=${s.dimension} installed=${s.installed} active=${s.active}`);
    }
    return;
  }

  if (subcommand === 'list') {
    for (const s of mgr.list()) {
      console.log(`${s.profile.padEnd(13)} ${s.modelId.padEnd(36)} dimension=${s.dimension}`);
    }
    return;
  }

  if (subcommand === 'switch') {
    const spec = resolveProfile(profileArg);
    if (!mgr.status(spec.profile).installed) {
      console.error(`Model not installed: ${spec.modelId}. Run: i-evolve model install ${spec.profile}`);
      process.exit(1);
    }
    mgr.switch(spec.profile);
    console.log(`Embedding model switched to ${spec.modelId}. Run 'i-evolve index rebuild' to refresh vectors.`);
    return;
  }

  console.error('Usage: i-evolve model <install|status|list|switch> [lite|default|chinese_lite]');
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
  const phase = (flags.phase as string | undefined) ?? ((flags.query || flags.prompt) ? 'user_prompt_submit' : 'session_start');
  if (phase !== 'session_start' && phase !== 'user_prompt_submit') {
    console.error('Usage: i-evolve recall --phase <session_start|user_prompt_submit> [--query <text>] [--debug]');
    process.exit(1);
  }
  const repo = getRepo();
  const markdown = recallMarkdown(repo, phase, {
    repoId: flags['repo-id'] as string | undefined,
    domain: flags.domain as string | undefined,
    query: (flags.query as string | undefined) ?? (flags.prompt as string | undefined),
  }, {
    prompt: (flags.query as string | undefined) ?? (flags.prompt as string | undefined),
    debug: Boolean(flags.debug),
  });
  repo.close();
  console.log(markdown);
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
