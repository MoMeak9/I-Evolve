import { join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository } from '@i-evolve/storage';
import {
  SessionSummarizer,
  SessionStore,
  EvolutionPipeline,
  MockAiProvider,
  OpenAiCompatibleProvider,
  type AiProvider,
  type CreateMemoryFromDecisionInput,
} from '@i-evolve/ai-evolution';
import type { Observation, AuditAction } from '@i-evolve/core';

function getProvider(): AiProvider {
  const baseUrl = process.env.IEVOLVE_AI_BASE_URL;
  const apiKey = process.env.IEVOLVE_AI_API_KEY;
  const model = process.env.IEVOLVE_AI_MODEL;
  if (baseUrl && apiKey && model) {
    return new OpenAiCompatibleProvider({ baseUrl, apiKey, model });
  }
  const mock = new MockAiProvider();
  mock.setDefault('{"summary":"Session completed.","decisions":[],"constraints":[],"mistakes":[],"userCorrections":[],"filesTouched":[],"candidateMemoryHints":[],"candidateInstinctHints":[]}');
  return mock;
}

function readObservations(sessionId: string): Observation[] {
  const file = paths.observations.current;
  if (!existsSync(file)) return [];
  const observations: Observation[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obs = JSON.parse(line) as Observation;
      if (!sessionId || obs.sessionId === sessionId) observations.push(obs);
    } catch { /* skip */ }
  }
  return observations;
}

function appendAudit(action: AuditAction): void {
  const dir = paths.audit.dir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const month = new Date(action.createdAt).toISOString().slice(0, 7);
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(action) + '\n', 'utf-8');
}

export async function handleSessionCommand(
  subcommand: string | undefined,
  flags: Record<string, unknown>,
): Promise<void> {
  if (subcommand !== 'finalize') {
    console.error('Usage: i-evolve session finalize [--session <id>] [--auto-evolve]');
    process.exit(1);
  }

  const sessionId = (flags.session as string) ?? readLatestSessionId();
  if (!sessionId) {
    console.error('Warning: no session id and no observations found; nothing to finalize.');
    return;
  }

  const observations = readObservations(sessionId);
  const provider = getProvider();
  const summarizer = new SessionSummarizer(provider);

  const summary = await summarizer.summarize({
    sessionId,
    repoId: observations[0]?.repoId,
    observations,
    endedAt: new Date().toISOString(),
  });

  const store = new SessionStore(paths.sessions.dir);
  const savedPath = store.save(summary);
  console.log(`Session summary saved: ${savedPath}`);

  if (flags['auto-evolve']) {
    const repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(paths.base, 'shared', 'index.db'),
    });
    const pipeline = new EvolutionPipeline({
      provider,
      writeMemory: (input: CreateMemoryFromDecisionInput) =>
        repo.create({
          id: input.id, type: input.type, scope: input.scope, title: input.title,
          content: input.content, status: 'active', visibility: input.visibility,
          confidence: input.confidence, ttlDays: input.ttlDays, expiresAt: input.expiresAt,
          tags: input.tags, sourceRefs: input.sourceRefs, repoId: input.repoId,
          domain: input.domain,
        } as any),
      appendAudit,
    });
    const results = await pipeline.run(summary);
    repo.close();
    console.log(`Auto-evolution: ${results.filter((r) => r.written).length} memory(ies) written.`);
  }
}

function readLatestSessionId(): string | undefined {
  const file = paths.observations.current;
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return (JSON.parse(lines[i]) as Observation).sessionId; } catch { /* skip */ }
  }
  return undefined;
}
