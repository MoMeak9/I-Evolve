import type { CandidateMemory, PolicyDecision } from '@i-evolve/core';
import type { MemoryScope } from '@i-evolve/shared';
import { runPolicyChecks, type PolicyCheckContext } from './policy-checks.js';
import { decideTtl } from './TtlJudge.js';
import { decideScope } from './ScopeJudge.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class PolicyJudge {
  judge(candidate: CandidateMemory, ctx: PolicyCheckContext = {}, now: string = new Date().toISOString()): PolicyDecision {
    const policyChecks = runPolicyChecks(candidate, ctx);
    const hardFailure = policyChecks.find(
      (c) => !c.passed && ['secret_detection', 'pii_detection', 'tombstone_similarity_check', 'schema_validation', 'duplicate_check'].includes(c.policy),
    );

    if (hardFailure) {
      return {
        decision: 'reject',
        confidence: candidate.confidence,
        reason: hardFailure.reason ?? `Failed ${hardFailure.policy}`,
        policyChecks,
      };
    }

    // confidence gate
    if (candidate.confidence < 0.7) {
      return {
        decision: candidate.confidence < 0.5 ? 'reject' : 'needs_more_evidence',
        confidence: candidate.confidence,
        reason: `Confidence ${candidate.confidence} below activation threshold 0.7`,
        policyChecks,
      };
    }

    // scope decision (may downgrade)
    const scopeResult = decideScope(candidate);
    const finalScope = scopeResult.scope;

    // global requires confidence >= 0.9
    if (finalScope === 'global' && candidate.confidence < 0.9) {
      const downgraded = decideScope({ ...candidate, proposedScope: 'domain' });
      return {
        decision: 'downgrade_scope',
        finalScope: downgraded.scope,
        finalType: candidate.type,
        confidence: candidate.confidence,
        ttlDays: decideTtl(candidate.type, downgraded.scope),
        expiresAt: computeExpiry(now, decideTtl(candidate.type, downgraded.scope)),
        reason: 'Global scope requires confidence >= 0.9; downgraded to domain',
        policyChecks,
      };
    }

    const ttlDays = decideTtl(candidate.type, finalScope);

    if (scopeResult.downgraded) {
      return {
        decision: 'downgrade_scope',
        finalScope,
        finalType: candidate.type,
        confidence: candidate.confidence,
        ttlDays,
        expiresAt: computeExpiry(now, ttlDays),
        reason: scopeResult.reason ?? 'Scope downgraded by policy',
        policyChecks,
      };
    }

    return {
      decision: 'activate',
      finalScope,
      finalType: candidate.type,
      confidence: candidate.confidence,
      ttlDays,
      expiresAt: computeExpiry(now, ttlDays),
      reason: 'Meets confidence and scope policies',
      policyChecks,
    };
  }
}

function computeExpiry(now: string, ttlDays: number | null): string | null {
  if (ttlDays === null) return null;
  return new Date(Date.parse(now) + ttlDays * DAY_MS).toISOString();
}
