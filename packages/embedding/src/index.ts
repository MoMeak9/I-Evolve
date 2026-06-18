export type { EmbeddingProvider, EmbedKind, ProfileName, ProfileSpec } from './provider.js';
export { PROFILES, resolveProfile, l2Normalize, meanPool } from './provider.js';
export { TransformersProvider } from './transformers-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { createProvider, type Runtime } from './factory.js';
export { ModelManager, type ModelStatus } from './model-manager.js';
