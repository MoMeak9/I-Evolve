import type { AiProvider, AiCompleteInput, AiCompleteOutput } from './AiProvider.js';

/**
 * Deterministic mock provider for tests and offline dev.
 * It does not call any external model. Instead, callers can register
 * canned responses keyed by a marker present in the prompt, or it
 * falls back to echoing a default JSON payload.
 */
export class MockAiProvider implements AiProvider {
  private responses: Array<{ match: (p: string) => boolean; response: string }> = [];
  private defaultResponse = '{}';

  setDefault(response: string): void {
    this.defaultResponse = response;
  }

  on(match: string | ((p: string) => boolean), response: string): this {
    const matcher = typeof match === 'string' ? (p: string) => p.includes(match) : match;
    this.responses.push({ match: matcher, response });
    return this;
  }

  async complete(input: AiCompleteInput): Promise<AiCompleteOutput> {
    for (const r of this.responses) {
      if (r.match(input.prompt) || r.match(input.system)) {
        return { text: r.response };
      }
    }
    return { text: this.defaultResponse };
  }
}
