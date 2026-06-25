import type { Observation, CandidateMemory, SessionSummary, AuditAction } from '@i-evolve/core';
import type { PolicyDecision } from '@i-evolve/core';
import type { UnifiedExtractionResult } from '@i-evolve/ai-evolution';

export interface AsyncFinalizerDeps {
  extract: (observations: Observation[], sessionId: string, repoId?: string) => Promise<UnifiedExtractionResult>;
  saveSession: (summary: SessionSummary) => void;
  countCandidatesBySlug: (slug: string) => number;
  createMemory: (input: any) => any;
  promoteCandidatesBySlug: (slug: string, content: string, newId: string) => any;
  appendAudit: (action: AuditAction) => void;
  judgeCandidate: (candidate: CandidateMemory) => PolicyDecision;
  logWarning?: (message: string) => void;
  onPromoted?: (memory: { id: string; visibility: string }) => Promise<void>;
}

const PROMOTION_THRESHOLD = 3;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [2000, 4000];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AsyncFinalizer {
  constructor(private deps: AsyncFinalizerDeps) {}

  async finalize(
    observations: Observation[],
    sessionId: string,
    repoId?: string,
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      try {
        await this.executeOnce(observations, sessionId, repoId);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    this.deps.logWarning?.(
      `AsyncFinalizer: failed after ${MAX_ATTEMPTS} attempts for session ${sessionId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async executeOnce(
    observations: Observation[],
    sessionId: string,
    repoId?: string,
  ): Promise<void> {
    const { summary, candidates } = await this.deps.extract(observations, sessionId, repoId);

    this.deps.saveSession(summary);

    const now = new Date().toISOString();

    for (const candidate of candidates) {
      const decision = this.deps.judgeCandidate(candidate);

      if (decision.decision === 'reject') {
        const slug = slugify(candidate.title);
        const id = buildId(candidate, slug);
        this.deps.appendAudit(buildAuditAction(id, decision, candidate, now, 'ai_reject'));
        continue;
      }

      const slug = slugify(candidate.title);
      const id = buildId(candidate, slug);
      const existingCount = this.deps.countCandidatesBySlug(slug);

      if (existingCount >= PROMOTION_THRESHOLD - 1) {
        this.deps.promoteCandidatesBySlug(slug, candidate.content, id);
        await this.deps.onPromoted?.({ id, visibility: 'team' });
      } else {
        this.deps.createMemory({
          id,
          title: candidate.title,
          type: candidate.type,
          scope: candidate.proposedScope,
          content: candidate.content,
          confidence: candidate.confidence,
          status: 'candidate',
          sourceRefs: candidate.sourceRefs,
          repoId: candidate.repoId,
          domain: candidate.domain,
        });
      }
    }
  }
}

function buildId(candidate: CandidateMemory, slug: string): string {
  const scope = candidate.proposedScope;
  const ns =
    scope === 'repo' ? (candidate.repoId ?? 'unknown').replace(/\//g, '-') :
    scope === 'domain' ? (candidate.domain ?? 'unknown') :
    scope;
  return `${scope}.${ns}.${slug}`;
}

function buildAuditAction(
  id: string,
  decision: PolicyDecision,
  candidate: CandidateMemory,
  now: string,
  action: AuditAction['action'],
): AuditAction {
  return {
    id: `audit.${id}.${now}`,
    memoryId: id,
    action,
    actorType: 'ai',
    actorId: 'i-evolve-async-finalizer',
    reason: decision.reason,
    confidence: decision.confidence,
    sourceRefs: candidate.sourceRefs,
    policyChecks: decision.policyChecks,
    createdAt: now,
  };
}
