import type { CandidateMemory, MemoryItem, PolicyDecision, SessionSummary, AuditAction } from '@i-evolve/core';
import type { MemoryScope, MemoryType, MemoryVisibility } from '@i-evolve/shared';
import { MemoryCandidateExtractor } from './extractor/MemoryCandidateExtractor.js';
import { PolicyJudge } from './judge/PolicyJudge.js';
import type { PolicyCheckContext } from './judge/policy-checks.js';
import type { AiProvider } from './provider/AiProvider.js';

export interface CreateMemoryFromDecisionInput {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  title: string;
  content: string;
  confidence: number;
  visibility: MemoryVisibility;
  ttlDays: number | null;
  expiresAt: string | null;
  tags: string[];
  sourceRefs: string[];
  repoId?: string;
  domain?: string;
}

export interface EvolutionDeps {
  provider: AiProvider;
  /** Persist an activated/downgraded memory. Returns the stored item. */
  writeMemory: (input: CreateMemoryFromDecisionInput) => MemoryItem | Promise<MemoryItem>;
  /** Append an audit action for every AI decision. */
  appendAudit: (action: AuditAction) => void | Promise<void>;
  /** Context for policy checks (tombstones, existing ids). */
  policyContext?: PolicyCheckContext;
  /** Inject deterministic id/time generation for tests. */
  now?: () => string;
  idForCandidate?: (candidate: CandidateMemory, scope: MemoryScope) => string;
}

export interface EvolutionResult {
  candidate: CandidateMemory;
  decision: PolicyDecision;
  memoryId?: string;
  written: boolean;
}

export class EvolutionPipeline {
  private extractor: MemoryCandidateExtractor;
  private judge = new PolicyJudge();

  constructor(private deps: EvolutionDeps) {
    this.extractor = new MemoryCandidateExtractor(deps.provider);
  }

  async run(summary: SessionSummary, options: { dryRun?: boolean } = {}): Promise<EvolutionResult[]> {
    const candidates = await this.extractor.extract(summary);
    const results: EvolutionResult[] = [];

    for (const candidate of candidates) {
      const result = await this.processCandidate(candidate, summary, options.dryRun ?? false);
      results.push(result);
    }

    return results;
  }

  async processCandidate(
    candidate: CandidateMemory,
    summary: SessionSummary,
    dryRun: boolean,
  ): Promise<EvolutionResult> {
    const now = this.deps.now?.() ?? new Date().toISOString();
    const decision = this.judge.judge(candidate, this.deps.policyContext, now);

    const scope = decision.finalScope ?? candidate.proposedScope;
    const id = this.deps.idForCandidate?.(candidate, scope) ?? defaultId(candidate, scope);

    const shouldWrite = decision.decision === 'activate' || decision.decision === 'downgrade_scope';

    if (!dryRun) {
      const action = decision.decision === 'activate' ? 'ai_approve' : decision.decision === 'reject' ? 'ai_reject' : 'scope_downgrade';
      await this.deps.appendAudit({
        id: `audit.${id}.${now}`,
        memoryId: id,
        action: action as AuditAction['action'],
        actorType: 'ai',
        actorId: 'i-evolve-policy-v1',
        reason: decision.reason,
        confidence: decision.confidence,
        sourceRefs: candidate.sourceRefs,
        policyChecks: decision.policyChecks,
        createdAt: now,
      });
    }

    if (shouldWrite && !dryRun) {
      await this.deps.writeMemory({
        id,
        type: decision.finalType ?? candidate.type,
        scope,
        title: candidate.title,
        content: candidate.content,
        confidence: decision.confidence,
        visibility: 'private',
        ttlDays: decision.ttlDays ?? null,
        expiresAt: decision.expiresAt ?? null,
        tags: [],
        sourceRefs: candidate.sourceRefs,
        repoId: candidate.repoId,
        domain: candidate.domain,
      });
    }

    return {
      candidate,
      decision,
      memoryId: shouldWrite ? id : undefined,
      written: shouldWrite && !dryRun,
    };
  }
}

function defaultId(candidate: CandidateMemory, scope: MemoryScope): string {
  const slug = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const ns =
    scope === 'repo' ? candidate.repoId?.replace(/\//g, '-') :
    scope === 'domain' ? candidate.domain :
    scope;
  return `${scope}.${ns ?? 'unknown'}.${slug}`;
}
