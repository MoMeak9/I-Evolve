import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Observation, SessionSummary, CandidateMemory } from '@i-evolve/core';
import type { ObservationSensitivity } from '@i-evolve/shared';
import type { AiProvider } from '../provider/AiProvider.js';
import { extractJson } from '../json-utils.js';
import { redact, containsSecret, containsPii } from '../redaction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), 'utf-8');
}

const UNIFIED_SYSTEM = loadPrompt('unified-extract.prompt.md');
const ENUM_CONTRACT = loadPrompt('enum-contract.md');

export interface UnifiedExtractionResult {
  summary: SessionSummary;
  candidates: CandidateMemory[];
}

interface RawSummaryOutput {
  summary?: string;
  decisions?: string[];
  constraints?: string[];
  mistakes?: string[];
  userCorrections?: string[];
  filesTouched?: string[];
  candidateMemoryHints?: string[];
  candidateInstinctHints?: string[];
}

interface RawModelOutput {
  summary?: RawSummaryOutput;
  candidates?: Partial<CandidateMemory>[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class UnifiedExtractor {
  constructor(private provider: AiProvider) {}

  async extract(
    observations: Observation[],
    sessionId: string,
    repoId?: string,
    ttlDays = 30,
  ): Promise<UnifiedExtractionResult> {
    const sensitivity = highestSensitivity(observations);

    const safeObservations = observations
      .filter((o) => o.sensitivity !== 'sensitive')
      .map((o) => ({
        phase: o.phase,
        tool: o.tool,
        summary: redact(o.summary).text,
        filesTouched: o.filesTouched,
        status: o.status,
      }));

    const prompt = `Observations:\n${JSON.stringify(safeObservations, null, 2)}`;
    const { text } = await this.provider.complete({
      system: UNIFIED_SYSTEM + '\n\n' + ENUM_CONTRACT,
      prompt,
      temperature: 0.2,
    });

    const raw = extractJson<RawModelOutput>(text);

    const endedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(endedAt) + ttlDays * DAY_MS).toISOString();
    const rawSummary = raw.summary ?? {};
    const filesTouched =
      rawSummary.filesTouched ??
      dedupe(observations.flatMap((o) => o.filesTouched ?? []));

    const summary: SessionSummary = {
      id: `session-summary.${sessionId}`,
      sessionId,
      repoId,
      endedAt,
      summary: rawSummary.summary ?? '',
      decisions: rawSummary.decisions ?? [],
      constraints: rawSummary.constraints ?? [],
      mistakes: rawSummary.mistakes ?? [],
      userCorrections: rawSummary.userCorrections ?? [],
      filesTouched,
      candidateMemoryHints: rawSummary.candidateMemoryHints ?? [],
      candidateInstinctHints: rawSummary.candidateInstinctHints ?? [],
      sensitivity,
      expiresAt,
    };

    const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
    const candidates = rawCandidates
      .map((c) => normalizeCandidate(c, sessionId, repoId))
      .filter((c): c is CandidateMemory => c !== null)
      .filter((c) => c.confidence >= 0.7);

    return { summary, candidates };
  }
}

function normalizeCandidate(
  c: Partial<CandidateMemory>,
  sessionId: string,
  repoId?: string,
): CandidateMemory | null {
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
    sourceRefs: c.sourceRefs ?? [`session-summary.${sessionId}`],
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    riskFlags: [...new Set(riskFlags)],
    repoId: c.repoId ?? repoId,
    domain: c.domain,
  };
}

function highestSensitivity(observations: Observation[]): ObservationSensitivity {
  const order: ObservationSensitivity[] = ['public', 'internal', 'sensitive'];
  let max: ObservationSensitivity = 'public';
  for (const o of observations) {
    if (order.indexOf(o.sensitivity) > order.indexOf(max)) max = o.sensitivity;
  }
  return max;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
