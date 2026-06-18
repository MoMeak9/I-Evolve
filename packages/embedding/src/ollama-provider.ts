import type { EmbeddingProvider, EmbedKind, ProfileSpec } from './provider.js';

/** 预留：将来通过本地 ollama HTTP API 实现。当前为桩。 */
export class OllamaProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimension: number;
  constructor(spec: ProfileSpec) {
    this.id = spec.modelId;
    this.dimension = spec.dimension;
  }
  async isReady(): Promise<boolean> {
    return false;
  }
  async embed(_texts: string[], _kind: EmbedKind): Promise<Float32Array[]> {
    throw new Error('ollama provider not implemented yet');
  }
}
