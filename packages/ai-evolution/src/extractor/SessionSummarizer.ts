import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Observation, SessionSummary } from '@i-evolve/core';
import type { ObservationSensitivity } from '@i-evolve/shared';
import type { AiProvider } from '../provider/AiProvider.js';
import { redact } from '../redaction.js';
import { extractJson } from '../json-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), 'utf-8');
}

const SESSION_SUMMARY_SYSTEM = loadPrompt('session-summary.prompt.md');
const ENUM_CONTRACT = loadPrompt('enum-contract.md');

interface SummaryModelOutput {
  summary: string;
  decisions?: string[];
  constraints?: string[];
  mistakes?: string[];
  userCorrections?: string[];
  filesTouched?: string[];
  candidateMemoryHints?: string[];
  candidateInstinctHints?: string[];
}

export interface SummarizeInput {
  sessionId: string;
  repoId?: string;
  observations: Observation[];
  startedAt?: string;
  endedAt: string;
  ttlDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class SessionSummarizer {
  constructor(private provider: AiProvider) {}

  async summarize(input: SummarizeInput): Promise<SessionSummary> {
    const sensitivity = highestSensitivity(input.observations);

    const safeObservations = input.observations
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
      system: SESSION_SUMMARY_SYSTEM + '\n\n' + ENUM_CONTRACT,
      prompt,
      temperature: 0.2,
    });

    const parsed = extractJson<SummaryModelOutput>(text);
    const filesTouched =
      parsed.filesTouched ??
      dedupe(input.observations.flatMap((o) => o.filesTouched ?? []));

    const ttlDays = input.ttlDays ?? 30;
    const expiresAt = new Date(Date.parse(input.endedAt) + ttlDays * DAY_MS).toISOString();

    return {
      id: `session-summary.${input.sessionId}`,
      sessionId: input.sessionId,
      repoId: input.repoId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      summary: parsed.summary ?? '',
      decisions: parsed.decisions ?? [],
      constraints: parsed.constraints ?? [],
      mistakes: parsed.mistakes ?? [],
      userCorrections: parsed.userCorrections ?? [],
      filesTouched,
      candidateMemoryHints: parsed.candidateMemoryHints ?? [],
      candidateInstinctHints: parsed.candidateInstinctHints ?? [],
      sensitivity,
      expiresAt,
    };
  }
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
