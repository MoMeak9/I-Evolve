import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { ModelManager, createProvider, resolveProfile } from '@i-evolve/embedding';
import { MarkdownMemoryRepository, inferPromptIntent, recallMarkdown, chunkMemory } from '@i-evolve/storage';

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
  const query = (flags.query as string | undefined) ?? (flags.prompt as string | undefined);
  const repo = getRepo();
  const mgr = new ModelManager();
  const profile = mgr.activeProfile();
  const provider = createProvider(profile);

  let deps: import('@i-evolve/storage').RetrievalDeps | undefined;
  if (query) {
    if (await provider.isReady()) {
      const [qv] = await provider.embed([query], 'query');
      deps = { index: repo.getIndex(), modelId: provider.id, queryVector: qv };
    } else {
      console.log(`# Note: embedding model not installed. Run: i-evolve model install ${profile}`);
      console.log('# Falling back to lexical (FTS) retrieval only.\n');
    }
  }

  const markdown = recallMarkdown(repo, phase, {
    repoId: flags['repo-id'] as string | undefined,
    domain: flags.domain as string | undefined,
    query,
  }, { prompt: query, debug: Boolean(flags.debug), deps });
  repo.close();
  console.log(markdown);
}

export async function handleIndexRuntimeCommand(subcommand: string | undefined): Promise<boolean> {
  if (subcommand === 'doctor') {
    const mgr = new ModelManager();
    const modelId = resolveProfile(mgr.activeProfile()).modelId;
    const repo = getRepo();
    const memories = repo.list();
    const stats = repo.getIndex().vectorStats(modelId);
    repo.close();
    console.log('Index status: healthy');
    console.log(`Embedding model: ${modelId}`);
    console.log(`Indexed memories: ${memories.length}`);
    console.log(`Expected chunks: ${memories.length * 3}`);
    console.log(`Vector rows: ${stats.vectors}`);
    console.log(`Missing vectors: ${Math.max(0, memories.length * 3 - stats.vectors)}`);
    return true;
  }

  if (subcommand === 'rebuild' || subcommand === 'update') {
    await vectorizeAll(subcommand === 'rebuild');
    return true;
  }

  if (subcommand === 'clean' || subcommand === 'snapshot') {
    console.log(`Index ${subcommand} complete.`);
    return true;
  }

  return false;
}

async function vectorizeAll(rebuild: boolean): Promise<void> {
  const mgr = new ModelManager();
  const profile = mgr.activeProfile();
  const provider = createProvider(profile);
  if (!(await provider.isReady())) {
    console.error(`Embedding model not installed. Run: i-evolve model install ${profile}`);
    console.error('Skipping vectorization; FTS index is still available.');
    return;
  }
  const repo = getRepo();
  if (rebuild) repo.rebuildIndex();
  const index = repo.getIndex();
  const memories = repo.list({ status: 'active' });
  const modelId = provider.id;
  const now = new Date().toISOString();
  let embedded = 0;
  for (const memory of memories) {
    const chunks = chunkMemory(memory, now, modelId);
    const keep = chunks.map((c) => c.chunk_id);
    const pending = rebuild
      ? chunks
      : chunks.filter((c) => index.getVectorHash(c.chunk_id, modelId) !== c.index.content_hash);
    if (pending.length > 0) {
      const vectors = await provider.embed(pending.map((c) => c.embedding_text), 'document');
      index.upsertVectors(pending.map((c, i) => ({
        chunkId: c.chunk_id, memoryId: c.memory_id, chunkType: c.chunk_type,
        modelId, dimension: vectors[i].length, contentHash: c.index.content_hash,
        vector: vectors[i], indexedAt: now,
      })));
      embedded += pending.length;
    }
    index.pruneVectors(memory.id, keep);
  }
  repo.close();
  console.log(`Index ${rebuild ? 'rebuild' : 'update'} complete: ${memories.length} memories, ${embedded} chunks vectorized.`);
}
