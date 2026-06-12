import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { paths } from '@i-evolve/daemon';
import { MarkdownMemoryRepository } from '@i-evolve/storage';
import {
  MockAiProvider,
  OpenAiCompatibleProvider,
  EvolutionPipeline,
  SessionStore,
  type AiProvider,
  type CreateMemoryFromDecisionInput,
} from '@i-evolve/ai-evolution';
import type { AuditAction } from '@i-evolve/core';

function getRepo(): MarkdownMemoryRepository {
  return new MarkdownMemoryRepository({
    memoryDir: paths.shared.memory,
    dbPath: join(paths.base, 'shared', 'index.db'),
  });
}

function getProvider(): AiProvider {
  const baseUrl = process.env.IEVOLVE_AI_BASE_URL;
  const apiKey = process.env.IEVOLVE_AI_API_KEY;
  const model = process.env.IEVOLVE_AI_MODEL;
  if (baseUrl && apiKey && model) {
    return new OpenAiCompatibleProvider({ baseUrl, apiKey, model });
  }
  // Offline default: produces no candidates.
  const mock = new MockAiProvider();
  mock.setDefault('[]');
  return mock;
}

function appendAudit(action: AuditAction): void {
  const dir = paths.audit.dir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const month = new Date(action.createdAt).toISOString().slice(0, 7);
  const file = join(dir, `${month}.jsonl`);
  appendFileSync(file, JSON.stringify(action) + '\n', 'utf-8');
}

export async function handleEvolveCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  const sessionId = flags.session as string | undefined;
  if (!sessionId) { console.error('Error: --session <id> required'); process.exit(1); }

  const store = new SessionStore(paths.sessions.dir);
  const summary = store.load(sessionId);
  if (!summary) { console.error(`Session summary not found: ${sessionId}`); process.exit(1); }

  const dryRun = subcommand === 'dry-run';
  const repo = getRepo();

  const pipeline = new EvolutionPipeline({
    provider: getProvider(),
    writeMemory: (input: CreateMemoryFromDecisionInput) => {
      return repo.create({
        id: input.id,
        type: input.type,
        scope: input.scope,
        title: input.title,
        content: input.content,
        status: 'active',
        visibility: input.visibility,
        confidence: input.confidence,
        ttlDays: input.ttlDays,
        expiresAt: input.expiresAt,
        tags: input.tags,
        sourceRefs: input.sourceRefs,
        repoId: input.repoId,
        projectId: input.projectId,
        domain: input.domain,
      } as any);
    },
    appendAudit,
  });

  const results = await pipeline.run(summary, { dryRun });
  repo.close();

  console.log(`Evolution ${dryRun ? '(dry-run) ' : ''}complete: ${results.length} candidate(s)`);
  for (const r of results) {
    const tag = r.written ? 'WRITE' : r.decision.decision.toUpperCase();
    console.log(`  [${tag}] ${r.candidate.title} — ${r.decision.reason}`);
  }
}

export function readAuditActions(): AuditAction[] {
  const dir = paths.audit.dir;
  if (!existsSync(dir)) return [];
  const actions: AuditAction[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const content = readFileSync(join(dir, file), 'utf-8');
    for (const line of content.split('\n')) {
      if (line.trim()) {
        try { actions.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
  }
  return actions;
}

export async function handleAuditCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  const actions = readAuditActions();

  switch (subcommand) {
    case 'list': {
      for (const a of actions.slice(-50)) {
        console.log(`[${a.createdAt}] ${a.action} ${a.memoryId} (conf=${a.confidence})`);
      }
      if (actions.length === 0) console.log('(no audit actions)');
      break;
    }
    case 'show': {
      const memoryId = args[0];
      if (!memoryId) { console.error('Error: memory id required'); process.exit(1); }
      const matching = actions.filter((a) => a.memoryId === memoryId);
      console.log(JSON.stringify(matching, null, 2));
      break;
    }
    case 'explain': {
      const memoryId = args[0];
      if (!memoryId) { console.error('Error: memory id required'); process.exit(1); }
      const matching = actions.filter((a) => a.memoryId === memoryId);
      for (const a of matching) {
        console.log(`${a.action} by ${a.actorId} (conf=${a.confidence})`);
        console.log(`  reason: ${a.reason}`);
        for (const check of a.policyChecks) {
          console.log(`  - ${check.policy}: ${check.passed ? 'pass' : 'FAIL'}${check.reason ? ` (${check.reason})` : ''}`);
        }
      }
      if (matching.length === 0) console.log(`No audit records for ${memoryId}`);
      break;
    }
    default:
      console.error('Usage: i-evolve audit <list|show|explain>');
      process.exit(1);
  }
}
