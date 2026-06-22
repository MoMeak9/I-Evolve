import { execFileSync } from 'node:child_process';
import type { AiProvider, AiCompleteInput, AiCompleteOutput } from './AiProvider.js';
import { firstBalancedJson } from './json-extract.js';

export class ClaudeCliProvider implements AiProvider {
  constructor(private model: string = 'sonnet') {}

  async complete(input: AiCompleteInput): Promise<AiCompleteOutput> {
    const raw = execFileSync(
      'claude',
      [
        '-p',
        '--model', this.model,
        '--output-format', 'text',
        '--allowed-tools', '',
        '--system-prompt', input.system,
      ],
      {
        input: input.prompt,
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return { text: firstBalancedJson(raw) ?? raw };
  }
}
