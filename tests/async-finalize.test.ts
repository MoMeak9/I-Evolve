import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { setBasePath, paths } from '../packages/daemon/src/paths.js';
import { AsyncFinalizer } from '../packages/daemon/src/async-finalizer.js';
import { UnifiedExtractor } from '../packages/ai-evolution/src/extractor/UnifiedExtractor.js';
import { PolicyJudge } from '../packages/ai-evolution/src/judge/PolicyJudge.js';
import { SessionStore } from '../packages/ai-evolution/src/session-store.js';
import { MarkdownMemoryRepository } from '../packages/storage/src/memory-repository.js';
import type { Observation, AuditAction } from '@i-evolve/core';
import type { AiProvider } from '../packages/ai-evolution/src/provider/AiProvider.js';

let tmpDir: string;
let repo: MarkdownMemoryRepository | undefined;

afterEach(() => {
  repo?.close();
  repo = undefined;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeMockProvider(response: object): AiProvider {
  return {
    complete: async () => ({ text: JSON.stringify(response) }),
  };
}

function makeObservation(sessionId: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1',
    timestamp: new Date().toISOString(),
    sessionId,
    source: 'hook',
    phase: 'post_tool',
    tool: 'Edit',
    summary: 'Edited src/index.ts to add pagination logic',
    filesTouched: ['src/index.ts'],
    status: 'complete',
    sensitivity: 'internal',
    ...overrides,
  };
}

describe('async finalize integration', () => {
  it('writes session summary and candidate memory', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ie-async-finalize-'));
    setBasePath(tmpDir);

    // Create required directories
    mkdirSync(paths.observations.dir, { recursive: true });
    mkdirSync(paths.sessions.dir, { recursive: true });
    mkdirSync(paths.shared.memory, { recursive: true });
    mkdirSync(paths.audit.dir, { recursive: true });
    mkdirSync(paths.logs.dir, { recursive: true });

    const sessionId = 'test-session-001';

    // Mock LLM returns a valid summary + one candidate
    const mockLlmResponse = {
      summary: {
        summary: 'Added pagination logic to index.ts',
        decisions: ['use cursor-based pagination'],
        constraints: [],
        mistakes: [],
        userCorrections: [],
        filesTouched: ['src/index.ts'],
        candidateMemoryHints: ['pagination pattern'],
        candidateInstinctHints: [],
      },
      candidates: [
        {
          title: 'cursor-based pagination pattern',
          type: 'repo_fact',
          proposedScope: 'repo',
          content: 'This repo uses cursor-based pagination for list endpoints.',
          evidence: ['Edited src/index.ts to add pagination logic'],
          sourceRefs: [`session-summary.${sessionId}`],
          confidence: 0.85,
          riskFlags: [],
          repoId: 'acme/app',
        },
      ],
    };

    const provider = makeMockProvider(mockLlmResponse);
    const extractor = new UnifiedExtractor(provider);
    const judge = new PolicyJudge();
    const sessionStore = new SessionStore(paths.sessions.dir);

    repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(tmpDir, 'shared', 'index.db'),
    });

    const auditLog: AuditAction[] = [];

    const finalizer = new AsyncFinalizer({
      extract: (obs, sid, rid) => extractor.extract(obs, sid, rid),
      saveSession: (summary) => sessionStore.save(summary),
      countCandidatesBySlug: (slug) => repo!.countCandidatesBySlug(slug),
      // AsyncFinalizer doesn't pass visibility; supply a default so the repo create succeeds
      createMemory: (input) => repo!.create({ visibility: 'private', ttlDays: null, expiresAt: null, tags: [], ...input }),
      promoteCandidatesBySlug: (slug, content, newId) =>
        repo!.promoteCandidatesBySlug(slug, content, newId),
      appendAudit: (action) => auditLog.push(action),
      judgeCandidate: (candidate) => judge.judge(candidate),
    });

    const observations = [makeObservation(sessionId, { repoId: 'acme/app' })];

    await finalizer.finalize(observations, sessionId, 'acme/app');

    // Assert: session summary was saved
    const saved = sessionStore.load(sessionId);
    expect(saved).not.toBeNull();
    expect(saved!.sessionId).toBe(sessionId);
    expect(saved!.summary).toBe('Added pagination logic to index.ts');

    // Assert: candidate memory was created
    const memories = repo!.list({ status: 'candidate' });
    expect(memories.length).toBeGreaterThanOrEqual(1);
    const mem = memories.find((m) => m.title === 'cursor-based pagination pattern');
    expect(mem).toBeDefined();
    expect(mem!.scope).toBe('repo');
    expect(mem!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('still saves session summary even when LLM returns no candidates', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ie-async-finalize-nocand-'));
    setBasePath(tmpDir);

    mkdirSync(paths.sessions.dir, { recursive: true });
    mkdirSync(paths.shared.memory, { recursive: true });
    mkdirSync(paths.audit.dir, { recursive: true });

    const sessionId = 'test-session-002';

    const mockLlmResponse = {
      summary: {
        summary: 'Minor cleanup',
        decisions: [],
        constraints: [],
        mistakes: [],
        userCorrections: [],
        filesTouched: [],
        candidateMemoryHints: [],
        candidateInstinctHints: [],
      },
      candidates: [],
    };

    const provider = makeMockProvider(mockLlmResponse);
    const extractor = new UnifiedExtractor(provider);
    const judge = new PolicyJudge();
    const sessionStore = new SessionStore(paths.sessions.dir);

    repo = new MarkdownMemoryRepository({
      memoryDir: paths.shared.memory,
      dbPath: join(tmpDir, 'shared', 'index.db'),
    });

    const finalizer = new AsyncFinalizer({
      extract: (obs, sid, rid) => extractor.extract(obs, sid, rid),
      saveSession: (summary) => sessionStore.save(summary),
      countCandidatesBySlug: (slug) => repo!.countCandidatesBySlug(slug),
      // AsyncFinalizer doesn't pass visibility; supply a default so the repo create succeeds
      createMemory: (input) => repo!.create({ visibility: 'private', ttlDays: null, expiresAt: null, tags: [], ...input }),
      promoteCandidatesBySlug: (slug, content, newId) =>
        repo!.promoteCandidatesBySlug(slug, content, newId),
      appendAudit: () => {},
      judgeCandidate: (candidate) => judge.judge(candidate),
    });

    await finalizer.finalize([makeObservation(sessionId)], sessionId);

    const saved = sessionStore.load(sessionId);
    expect(saved).not.toBeNull();
    expect(saved!.sessionId).toBe(sessionId);

    const memories = repo!.list();
    expect(memories.length).toBe(0);
  });
});
