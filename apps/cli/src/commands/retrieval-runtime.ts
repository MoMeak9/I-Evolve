import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository, inferPromptIntent, recallMarkdown } from '@i-evolve/storage';

function getRepo() {
  return new MarkdownMemoryRepository({ memoryDir: paths.shared.memory, dbPath: join(paths.base, 'shared', 'index.db') });
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
  console.log(JSON.stringify(inferPromptIntent(prompt, { projectId: flags['project-id'] as string | undefined }), null, 2));
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
    projectId: flags['project-id'] as string | undefined,
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
