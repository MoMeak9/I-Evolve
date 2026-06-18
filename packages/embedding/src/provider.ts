export type EmbedKind = 'document' | 'query';

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimension: number;
  isReady(): Promise<boolean>;
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
}

export type ProfileName = 'lite' | 'default' | 'chinese_lite';

export interface ProfileSpec {
  profile: ProfileName;
  modelId: string;
  dimension: number;
  /** e5 系列需要 query:/passage: 前缀；bge 系列为空 */
  queryPrefix: string;
  docPrefix: string;
}

export const PROFILES: Record<ProfileName, ProfileSpec> = {
  lite: { profile: 'lite', modelId: 'Xenova/multilingual-e5-small', dimension: 384, queryPrefix: 'query: ', docPrefix: 'passage: ' },
  default: { profile: 'default', modelId: 'Xenova/bge-m3', dimension: 1024, queryPrefix: '', docPrefix: '' },
  chinese_lite: { profile: 'chinese_lite', modelId: 'Xenova/bge-small-zh-v1.5', dimension: 512, queryPrefix: '', docPrefix: '' },
};

export function resolveProfile(name: string | undefined): ProfileSpec {
  if (name && name in PROFILES) return PROFILES[name as ProfileName];
  return PROFILES.lite;
}

export function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** data 为行优先的 [tokens x dim]，对 tokens 维求均值，返回长度 dim 的向量。 */
export function meanPool(data: Float32Array, tokens: number, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let t = 0; t < tokens; t++) {
    for (let d = 0; d < dim; d++) out[d] += data[t * dim + d];
  }
  for (let d = 0; d < dim; d++) out[d] /= tokens || 1;
  return out;
}
