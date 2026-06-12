import type { CandidateMemory, SessionSummary } from '@i-evolve/core';
import type { AiProvider } from '../provider/AiProvider.js';
import { extractJson } from '../json-utils.js';
import { containsSecret, containsPii } from '../redaction.js';

const SYSTEM = `You are I-Evolve's memory candidate extractor. Return ONLY a JSON array of candidate memories with keys: title, type, proposedScope, content, evidence, sourceRefs, confidence, riskFlags. Avoid promoting single-task constraints to global. No secrets, PII, or raw code.`;

export class MemoryCandidateExtractor {
  constructor(private provider: AiProvider) {}

  async extract(summary: SessionSummary): Promise<CandidateMemory[]> {
    const prompt = buildPrompt(summary);
    const { text } = await this.provider.complete({ system: SYSTEM, prompt, temperature: 0.2 });
    const raw = extractJson<Partial<CandidateMemory>[]>(text);
    if (!Array.isArray(raw)) return [];

    return raw.map((c) => normalize(c, summary)).filter((c): c is CandidateMemory => c !== null);
  }
}

function buildPrompt(summary: SessionSummary): string {
  return JSON.stringify({
    summary: summary.summary,
    decisions: summary.decisions,
    constraints: summary.constraints,
    mistakes: summary.mistakes,
    userCorrections: summary.userCorrections,
    candidateMemoryHints: summary.candidateMemoryHints,
    repoId: summary.repoId,
    projectId: summary.projectId,
  }, null, 2);
}

function normalize(c: Partial<CandidateMemory>, summary: SessionSummary): CandidateMemory | null {
  if (!c.title || !c.content || !c.type || !c.proposedScope) return null;

  const riskFlags = [...(c.riskFlags ?? [])];
  if (containsSecret(c.content)) riskFlags.push('secret');
  if (containsPii(c.content)) riskFlags.push('pii');

  return {
    title: c.title,
    type: c.type,
    proposedScope: c.proposedScope,
    content: c.content,
    evidence: c.evidence ?? [],
    sourceRefs: c.sourceRefs ?? [summary.id],
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    riskFlags: [...new Set(riskFlags)],
    repoId: c.repoId ?? summary.repoId,
    projectId: c.projectId ?? summary.projectId,
    domain: c.domain,
  };
}
