import type { AiProvider, AiCompleteInput, AiCompleteOutput } from './AiProvider.js';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Minimal OpenAI-compatible chat completion provider using fetch.
 * No SDK dependency. Used in dev when explicitly configured.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private config: OpenAiCompatibleConfig) {}

  async complete(input: AiCompleteInput): Promise<AiCompleteOutput> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`AI provider error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return { text: data.choices[0]?.message?.content ?? '' };
  }
}
