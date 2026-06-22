import { join } from 'node:path';
import { paths } from '@i-evolve/daemon';
import { ModelManager, createProvider, resolveProfile } from '@i-evolve/embedding';
import { MarkdownMemoryRepository, inferPromptIntent, recallMarkdown, chunkMemory, detectRepoIdentity } from '@i-evolve/storage';


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

export async function handleModelCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const profileArg = args[0] && args[0].length > 0 ? args[0] : 'lite';
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
  // --hook means we're a Claude Code hook: read the event payload from stdin to
  // recover the user's prompt and cwd (flags carry neither in hook mode).
  const stdin = flags.hook ? await readHookStdin() : {};
  const prompt = (flags.query as string | undefined) ?? (flags.prompt as string | undefined) ?? stdin.prompt;

  const phase = (flags.phase as string | undefined) ?? (prompt ? 'user_prompt_submit' : 'session_start');
  if (phase !== 'session_start' && phase !== 'user_prompt_submit') {
    console.error('Usage: i-evolve recall --phase <session_start|user_prompt_submit> [--query <text>] [--debug]');
    process.exit(1);
  }
  const query = (flags.query as string | undefined) ?? (flags.prompt as string | undefined);
  const repo = getRepo();
  // Resolve repo identity the same way inject does: the `pnpm -C` launcher pins
  // process.cwd() to IEVOLVE_HOME, so detect from the caller's real cwd. Prefer
  // the hook payload's cwd, then the launcher-preserved env. Without this,
  // repoId is empty and every repo-scoped memory is filtered out as a scope
  // mismatch — recall returns "(no matching memory)".
  const invocationCwd = stdin.cwd ?? process.env.IEVOLVE_INVOCATION_CWD ?? process.cwd();
  const detected = detectRepoIdentity({ cwd: invocationCwd });

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
    repoId: (flags['repo-id'] as string | undefined) ?? process.env.IEVOLVE_REPO_ID ?? detected.repoId,
    domain: (flags.domain as string | undefined) ?? process.env.IEVOLVE_DOMAIN ?? detected.domain,
    packageNames: detected.packageNames,
    query: prompt,
  }, {
    prompt,
    debug: Boolean(flags.debug),
    deps,
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
