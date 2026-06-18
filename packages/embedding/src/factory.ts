import type { EmbeddingProvider } from './provider.js';
import { resolveProfile } from './provider.js';
import { TransformersProvider } from './transformers-provider.js';
import { OllamaProvider } from './ollama-provider.js';

export type Runtime = 'transformers' | 'ollama';

export function createProvider(profileName?: string, runtime: Runtime = 'transformers'): EmbeddingProvider {
  const spec = resolveProfile(profileName);
  return runtime === 'ollama' ? new OllamaProvider(spec) : new TransformersProvider(spec);
}
