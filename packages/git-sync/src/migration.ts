import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationStep {
  id: string;
  description: string;
  apply: (repoDir: string) => string[]; // returns list of changed file paths
}

export interface MigrationStatus {
  currentVersion: number;
  pending: MigrationStep[];
}

/**
 * Reads schema_version from memory-pack.yaml (simple line parse).
 */
export function readSchemaVersion(repoDir: string): number {
  const packPath = join(repoDir, 'memory-pack.yaml');
  if (!existsSync(packPath)) return 0;
  const content = readFileSync(packPath, 'utf-8');
  const m = content.match(/^schema_version:\s*(\d+)/m);
  return m ? parseInt(m[1], 10) : 0;
}

function bumpSchemaVersion(repoDir: string, version: number): void {
  const packPath = join(repoDir, 'memory-pack.yaml');
  const content = readFileSync(packPath, 'utf-8');
  const updated = content.replace(/^schema_version:\s*\d+/m, `schema_version: ${version}`);
  writeFileSync(packPath, updated, 'utf-8');
}

export function getMigrationStatus(repoDir: string, steps: MigrationStep[]): MigrationStatus {
  const currentVersion = readSchemaVersion(repoDir);
  const pending = steps.filter((s) => parseInt(s.id, 10) > currentVersion);
  return { currentVersion, pending };
}

export interface RunMigrationOptions {
  to?: number;
  dryRun?: boolean;
}

export interface MigrationResult {
  applied: string[];
  changedFiles: string[];
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
}

export function runMigrations(
  repoDir: string,
  steps: MigrationStep[],
  options: RunMigrationOptions = {},
): MigrationResult {
  const fromVersion = readSchemaVersion(repoDir);
  const target = options.to ?? Math.max(fromVersion, ...steps.map((s) => parseInt(s.id, 10)));
  const toApply = steps
    .filter((s) => {
      const v = parseInt(s.id, 10);
      return v > fromVersion && v <= target;
    })
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

  const applied: string[] = [];
  const changedFiles: string[] = [];

  for (const step of toApply) {
    if (!options.dryRun) {
      const changes = step.apply(repoDir);
      changedFiles.push(...changes);
    }
    applied.push(step.id);
  }

  const toVersion = toApply.length > 0 ? parseInt(toApply[toApply.length - 1].id, 10) : fromVersion;
  if (!options.dryRun && toApply.length > 0) {
    bumpSchemaVersion(repoDir, toVersion);
  }

  return { applied, changedFiles, fromVersion, toVersion, dryRun: options.dryRun ?? false };
}
