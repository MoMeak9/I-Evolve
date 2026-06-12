export { GitMemorySync, GitError } from './git-memory-sync.js';
export type { CommitOptions, RollbackOptions, SyncResult } from './git-memory-sync.js';
export { GitWorkspaceLock } from './workspace-lock.js';
export { validateMemoryRepo } from './validate.js';
export type { ValidateReport, ValidateIssue } from './validate.js';
export { git, isClean, currentCommit } from './git.js';
export {
  readSchemaVersion,
  getMigrationStatus,
  runMigrations,
} from './migration.js';
export type { MigrationStep, MigrationStatus, MigrationResult, RunMigrationOptions } from './migration.js';
