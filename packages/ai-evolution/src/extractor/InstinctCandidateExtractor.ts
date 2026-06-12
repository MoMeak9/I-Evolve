import type { CandidateInstinct, SessionSummary } from '@i-evolve/core';
import type { AiProvider } from '../provider/AiProvider.js';
import { extractJson } from '../json-utils.js';
import { containsSecret, containsPii } from '../redaction.js';

const SYSTEM = `You are I-Evolve's instinct candidate extractor. Instincts are agent behavior rules (workflow_rule type). Return ONLY a JSON array with keys: title, proposedScope, content, evidence, sourceRefs, confidence, riskFlags.`;

export class InstinctCandidateExtractor {
  constructor(private provider: AiProvider) {}

  async extract(summary: SessionSummary): Promise<CandidateInstinct[]> {
    const prompt = JSON.stringify({
      mistakes: summary.mistakes,
      userCorrections: summary.userCorrections,
      candidateInstinctHints: summary.candidateInstinctHints,
    }, null, 2);

    const { text } = await this.provider.complete({ system: SYSTEM, prompt, temperature: 0.2 });
    const raw = extractJson<Partial<CandidateInstinct>[]>(text);
    if (!Array.isArray(raw)) return [];

    return raw
      .map((c) => normalize(c, summary))
      .filter((c): c is CandidateInstinct => c !== null);
  }
}

function normalize(c: Partial<CandidateInstinct>, summary: SessionSummary): CandidateInstinct | null {
  if (!c.title || !c.content || !c.proposedScope) return null;
  const riskFlags = [...(c.riskFlags ?? [])];
  if (containsSecret(c.content)) riskFlags.push('secret');
  if (containsPii(c.content)) riskFlags.push('pii');
  return {
    title: c.title,
    proposedScope: c.proposedScope,
    content: c.content,
    evidence: c.evidence ?? [],
    sourceRefs: c.sourceRefs ?? [summary.id],
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    riskFlags: [...new Set(riskFlags)],
  };
}
