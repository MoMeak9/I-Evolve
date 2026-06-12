import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditAction } from '@i-evolve/core';
import { currentCommit, git, isClean } from './git.js';
import { GitWorkspaceLock } from './workspace-lock.js';

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
  appendAudit?: (action: AuditAction) => void;
}

export interface MigrationResult {
  applied: string[];
  changedFiles: string[];
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
}

export async function runMigrations(
  repoDir: string,
  steps: MigrationStep[],
  options: RunMigrationOptions = {},
): Promise<MigrationResult> {
  if (options.dryRun || !existsSync(join(repoDir, '.git'))) {
    return runMigrationsUnlocked(repoDir, steps, options);
  }

  const lock = new GitWorkspaceLock(repoDir);
  return lock.withLock(() => {
    const before = safeCurrentCommit(repoDir);
    const result = runMigrationsUnlocked(repoDir, steps, options);
    if (result.applied.length > 0 && !isClean(repoDir)) {
      git(repoDir, ['add', '-A']);
      git(repoDir, ['commit', '-m', `memory(system): migrate schema to ${result.toVersion}`]);
    }
    const after = safeCurrentCommit(repoDir);
    if (result.applied.length > 0) {
      options.appendAudit?.({
        id: `audit.${Date.now()}`,
        memoryId: 'schema.migration',
        action: 'migrate',
        actorType: 'system',
        actorId: 'i-evolve-migration',
        reason: `Applied schema migrations: ${result.applied.join(', ')}`,
        confidence: 1,
        beforeHash: before,
        afterHash: after,
        sourceRefs: result.applied,
        policyChecks: [{ policy: 'git_workspace_lock', passed: true }],
        createdAt: new Date().toISOString(),
      });
    }
    return result;
  });
}

function runMigrationsUnlocked(
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

function safeCurrentCommit(repoDir: string): string | undefined {
  try {
    return currentCommit(repoDir);
  } catch {
    return undefined;
  }
}
