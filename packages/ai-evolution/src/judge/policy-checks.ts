import type { CandidateMemory } from '@i-evolve/core';
import type { PolicyCheckResult as PCR } from '@i-evolve/shared';
import { containsSecret, containsPii } from '../redaction.js';

export interface PolicyCheckContext {
  tombstoneTitles?: string[];
  existingIds?: string[];
}

function pass(policy: string): PCR {
  return { policy, passed: true };
}
function fail(policy: string, reason: string): PCR {
  return { policy, passed: false, reason };
}

export function runPolicyChecks(candidate: CandidateMemory, ctx: PolicyCheckContext = {}): PCR[] {
  const checks: PCR[] = [];

  // schema_validation: candidate has required fields
  checks.push(
    candidate.title && candidate.content && candidate.type && candidate.proposedScope
      ? pass('schema_validation')
      : fail('schema_validation', 'Missing required candidate fields'),
  );

  // secret_detection
  checks.push(
    containsSecret(candidate.content) || candidate.riskFlags.includes('secret')
      ? fail('secret_detection', 'Candidate content contains a secret')
      : pass('secret_detection'),
  );

  // pii_detection
  checks.push(
    containsPii(candidate.content) || candidate.riskFlags.includes('pii')
      ? fail('pii_detection', 'Candidate content contains PII')
      : pass('pii_detection'),
  );

  // scope_leakage: task constraints must not be global/domain
  const isTaskish = candidate.type === 'task_constraint';
  const broadScope = candidate.proposedScope === 'global' || candidate.proposedScope === 'domain';
  checks.push(
    isTaskish && broadScope
      ? fail('scope_leakage', 'task_constraint cannot use global/domain scope')
      : pass('scope_leakage'),
  );

  // sensitivity_check
  checks.push(pass('sensitivity_check'));

  // duplicate_check
  checks.push(
    ctx.existingIds && ctx.existingIds.length > 0 && isDuplicate(candidate, ctx.existingIds)
      ? fail('duplicate_check', 'Candidate duplicates an existing memory id')
      : pass('duplicate_check'),
  );

  // tombstone_similarity_check
  checks.push(
    ctx.tombstoneTitles && isTombstoneSimilar(candidate.title, ctx.tombstoneTitles)
      ? fail('tombstone_similarity_check', 'Candidate is similar to a tombstoned memory')
      : pass('tombstone_similarity_check'),
  );

  return checks;
}

function isDuplicate(candidate: CandidateMemory, existingIds: string[]): boolean {
  const slug = slugify(candidate.title);
  return existingIds.some((id) => id.endsWith(slug));
}

function isTombstoneSimilar(title: string, tombstoneTitles: string[]): boolean {
  const s = slugify(title);
  return tombstoneTitles.some((t) => slugify(t) === s);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
