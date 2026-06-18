import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PROFILES, resolveProfile, type ProfileName } from './provider.js';

export interface ModelStatus {
  profile: ProfileName;
  modelId: string;
  dimension: number;
  installed: boolean;
  active: boolean;
}

export class ModelManager {
  private root: string;
  private now: string;

  /** baseDir 默认 ~/.i-evolve；now 可注入以便测试。 */
  constructor(baseDir: string = join(homedir(), '.i-evolve'), now: string = new Date().toISOString()) {
    this.root = join(baseDir, 'models');
    this.now = now;
  }

  private lockPath(modelId: string): string {
    return join(this.root, ...modelId.split('/'), 'model.lock.yaml');
  }

  writeLock(profileName: string, dimension: number, revision: string): void {
    const spec = resolveProfile(profileName);
    const dir = join(this.root, ...spec.modelId.split('/'));
    mkdirSync(join(dir, 'snapshots'), { recursive: true });
    const lock = [
      `model_id: ${spec.modelId}`,
      'runtime: transformers.js',
      `dimension: ${dimension}`,
      `revision: ${revision}`,
      `installed_at: ${this.now}`,
      'active: true',
      '',
    ].join('\n');
    writeFileSync(this.lockPath(spec.modelId), lock, 'utf-8');
    // 其余 profile 取消激活
    for (const other of Object.values(PROFILES)) {
      if (other.modelId !== spec.modelId) this.setActive(other.modelId, false);
    }
  }

  private setActive(modelId: string, active: boolean): void {
    const path = this.lockPath(modelId);
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf-8');
    const next = text.replace(/active: (true|false)/, `active: ${active}`);
    writeFileSync(path, next, 'utf-8');
  }

  private readField(modelId: string, key: string): string | null {
    const path = this.lockPath(modelId);
    if (!existsSync(path)) return null;
    const line = readFileSync(path, 'utf-8').split('\n').find((l) => l.startsWith(`${key}: `));
    return line ? line.slice(key.length + 2).trim() : null;
  }

  status(profileName: string): ModelStatus {
    const spec = resolveProfile(profileName);
    const installed = existsSync(this.lockPath(spec.modelId));
    return {
      profile: spec.profile,
      modelId: spec.modelId,
      dimension: spec.dimension,
      installed,
      active: installed && this.readField(spec.modelId, 'active') === 'true',
    };
  }

  list(): ModelStatus[] {
    return (Object.keys(PROFILES) as ProfileName[]).map((p) => this.status(p));
  }

  switch(profileName: string): void {
    const spec = resolveProfile(profileName);
    for (const other of Object.values(PROFILES)) {
      this.setActive(other.modelId, other.modelId === spec.modelId);
    }
  }

  /** 返回当前激活 profile 名；无激活时回退 lite。 */
  activeProfile(): ProfileName {
    for (const spec of Object.values(PROFILES)) {
      if (this.readField(spec.modelId, 'active') === 'true') return spec.profile;
    }
    return 'lite';
  }

  /** 当前激活模型的真实维度（从 lock 读，回退 profile 默认）。 */
  activeDimension(): number {
    const profile = this.activeProfile();
    const spec = resolveProfile(profile);
    const dim = this.readField(spec.modelId, 'dimension');
    return dim ? Number(dim) : spec.dimension;
  }
}
