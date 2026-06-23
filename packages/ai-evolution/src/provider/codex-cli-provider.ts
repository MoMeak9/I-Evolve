import { execFileSync } from 'node:child_process';
import type { AiProvider, AiCompleteInput, AiCompleteOutput } from './AiProvider.js';
import { firstBalancedJson } from './json-extract.js';

export class CodexCliProvider implements AiProvider {
  constructor(private model?: string) {}

  async complete(input: AiCompleteInput): Promise<AiCompleteOutput> {
    const args = ['exec'];
    if (this.model) args.push('--model', this.model);

    // codex exec has no --system-prompt flag; prepend system to prompt
    const fullPrompt = `${input.system}\n\n---\n\n${input.prompt}`;

    const raw = execFileSync('codex', args, {
      input: fullPrompt,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { text: firstBalancedJson(raw) ?? raw };
  }
}
