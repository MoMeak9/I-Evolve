import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { EmbeddingProvider, EmbedKind, ProfileSpec } from './provider.js';
import { l2Normalize, meanPool } from './provider.js';

const MODELS_ROOT = join(homedir(), '.i-evolve', 'models');

type FeatureExtractionPipeline = (text: string, opts?: Record<string, unknown>) => Promise<{
  data: Float32Array;
  dims: number[];
}>;

export class TransformersProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimension: number;
  private readonly spec: ProfileSpec;
  private pipe: FeatureExtractionPipeline | null = null;

  constructor(spec: ProfileSpec) {
    this.spec = spec;
    this.id = spec.modelId;
    this.dimension = spec.dimension;
  }

  /** 模型权重缓存目录是否已存在（粗判，避免误触发下载）。 */
  async isReady(): Promise<boolean> {
    const dir = join(MODELS_ROOT, ...this.spec.modelId.split('/'));
    return existsSync(dir);
  }

  private async ensurePipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) return this.pipe;
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = MODELS_ROOT;
    env.allowRemoteModels = true;
    this.pipe = (await pipeline('feature-extraction', this.spec.modelId)) as unknown as FeatureExtractionPipeline;
    return this.pipe;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    const pipe = await this.ensurePipeline();
    const prefix = kind === 'query' ? this.spec.queryPrefix : this.spec.docPrefix;
    const out: Float32Array[] = [];
    for (const text of texts) {
      const res = await pipe(prefix + text, { pooling: 'none' });
      // res.dims = [1, tokens, dim]
      const tokens = res.dims[res.dims.length - 2];
      const dim = res.dims[res.dims.length - 1];
      const pooled = meanPool(res.data, tokens, dim);
      out.push(l2Normalize(pooled));
    }
    return out;
  }
}
