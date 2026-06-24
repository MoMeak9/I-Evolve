import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { git, isClean, currentCommit, GitError } from './git.js';
import { GitWorkspaceLock } from './workspace-lock.js';
import { validateMemoryRepo, type ValidateReport } from './validate.js';
import type { AuditAction } from '@i-evolve/core';

export interface CommitOptions {
  message: string;
  reviewer?: string;
  decision?: string;
  confidence?: number;
  scope?: string;
  sourceSession?: string;
}

export interface RollbackOptions {
  toCommit: string;
  mode?: 'checkout' | 'revert';
  rebuildIndex?: () => void;
  appendAudit?: (action: AuditAction) => void;
}

export interface SyncResult {
  ok: boolean;
  message: string;
  commit?: string;
  previousCommit?: string;
}

export interface AttachResult {
  ok: boolean;
  message: string;
  /** Local files kept because the remote already provided that path. */
  collisions: string[];
  /** Local-only files restored on top of the cloned remote. */
  restored: string[];
}

export interface GitChangeOptions {
  rebuildIndex?: () => void;
  appendAudit?: (action: AuditAction) => void;
}

/**
 * Coordinates the single remote memory Git repo at repoDir.
 * Every mutating operation runs under the git workspace lock.
 */
export class GitMemorySync {
  private lock: GitWorkspaceLock;

  constructor(private repoDir: string) {
    this.lock = new GitWorkspaceLock(repoDir);
  }

  static clone(gitUrl: string, targetDir: string): void {
    // Clones into targetDir (parent must exist). No lock needed: repo doesn't exist yet.
    git(targetDir, ['clone', gitUrl, '.']);
  }

  /**
   * Attach an existing (possibly non-empty) memory dir to a remote git repo.
   *
   * - Already a git repo: no-op.
   * - Empty dir: plain clone.
   * - Non-empty dir: move local files aside, clone the remote in, then restore
   *   only the local-only files on top. Files that also exist in the remote are
   *   left as the remote version and reported as collisions; the local copies
   *   remain in the backup dir so nothing is lost. Restored local-only files are
   *   left uncommitted so the caller can review and commit them.
   *
   * On clone failure the original local files are moved back, leaving the dir
   * exactly as it was before.
   */
  attach(gitUrl: string): AttachResult {
    if (this.isInitialized()) {
      return { ok: true, message: 'already initialized', collisions: [], restored: [] };
    }
    if (!existsSync(this.repoDir)) {
      GitMemorySync.clone(gitUrl, this.repoDir);
      return { ok: true, message: `cloned ${gitUrl}`, collisions: [], restored: [] };
    }

    const localFiles = this.listFiles(this.repoDir);
    if (localFiles.length === 0) {
      GitMemorySync.clone(gitUrl, this.repoDir);
      return { ok: true, message: `cloned ${gitUrl}`, collisions: [], restored: [] };
    }

    const backup = mkdtempSync(join(dirname(this.repoDir), '.i-evolve-attach-'));
    for (const entry of readdirSync(this.repoDir)) {
      renameSync(join(this.repoDir, entry), join(backup, entry));
    }

    try {
      GitMemorySync.clone(gitUrl, this.repoDir);
    } catch (err) {
      // Roll back: restore original files, remove the backup.
      for (const entry of readdirSync(backup)) {
        renameSync(join(backup, entry), join(this.repoDir, entry));
      }
      this.removeDir(backup);
      throw err instanceof GitError
        ? err
        : new GitError(`attach failed: ${(err as Error).message}`);
    }

    const collisions: string[] = [];
    const restored: string[] = [];
    for (const rel of this.listFiles(backup)) {
      const target = join(this.repoDir, rel);
      if (existsSync(target)) {
        collisions.push(rel);
      } else {
        cpSync(join(backup, rel), target);
        restored.push(rel);
      }
    }

    const message = `cloned ${gitUrl}; restored ${restored.length} local file(s)` +
      (collisions.length ? `, ${collisions.length} kept remote (backup: ${backup})` : '');
    if (collisions.length === 0) this.removeDir(backup);
    return { ok: true, message, collisions, restored };
  }

  private listFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current)) {
        if (entry === '.git') continue;
        const full = join(current, entry);
        if (statSync(full).isDirectory()) walk(full);
        else out.push(relative(dir, full));
      }
    };
    walk(dir);
    return out;
  }

  private removeDir(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  isInitialized(): boolean {
    return existsSync(`${this.repoDir}/.git`);
  }

  hasRemote(): boolean {
    if (!this.isInitialized()) return false;
    try {
      const remotes = git(this.repoDir, ['remote']);
      return remotes.trim().length > 0;
    } catch {
      return false;
    }
  }

  status(): { clean: boolean; commit: string; branch: string } {
    return {
      clean: isClean(this.repoDir),
      commit: currentCommit(this.repoDir),
      branch: git(this.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    };
  }

  log(limit = 20): string {
    return git(this.repoDir, ['log', `-${limit}`, '--oneline']);
  }

  async commit(opts: CommitOptions): Promise<SyncResult> {
    return this.lock.withLock(() => {
      git(this.repoDir, ['add', '-A']);
      if (isClean(this.repoDir)) {
        return { ok: true, message: 'nothing to commit' };
      }
      const message = this.buildCommitMessage(opts);
      git(this.repoDir, ['commit', '-m', message]);
      return { ok: true, message: 'committed', commit: currentCommit(this.repoDir) };
    });
  }

  async pull(options: GitChangeOptions = {}): Promise<SyncResult> {
    return this.lock.withLock(() => {
      if (!isClean(this.repoDir)) {
        return { ok: false, message: 'working tree not clean; refusing to pull' };
      }
      const before = this.safeCurrentCommit();
      git(this.repoDir, ['fetch', 'origin']);
      try {
        git(this.repoDir, ['pull', '--ff-only']);
      } catch (err) {
        return { ok: false, message: `pull failed (conflict?): ${(err as Error).message}` };
      }
      const after = currentCommit(this.repoDir);
      this.afterGitChange('sync_pull', 'git pull completed', before, after, options);
      return { ok: true, message: 'pulled', commit: after, previousCommit: before };
    });
  }

  async push(options: Pick<GitChangeOptions, 'appendAudit'> = {}): Promise<SyncResult> {
    return this.lock.withLock(() => {
      const report = this.validate();
      if (!report.ok) {
        return { ok: false, message: `validation failed: ${report.issues.length} issue(s); push blocked` };
      }
      // Commit any pending working-tree changes (e.g. memories written by
      // `memory add`, which only touch files) so they are actually pushed.
      // Without this, push would no-op on an uncommitted tree yet still report
      // success. The tree was just validated above, so committing it is safe.
      const before = this.safeCurrentCommit();
      git(this.repoDir, ['add', '-A']);
      if (!isClean(this.repoDir)) {
        git(this.repoDir, ['commit', '-m', this.buildCommitMessage({ message: 'memory: sync pending changes' })]);
      }
      if (this.hasUpstream()) {
        git(this.repoDir, ['push']);
      } else {
        const branch = git(this.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
        git(this.repoDir, ['push', '-u', 'origin', branch]);
      }
      const commit = currentCommit(this.repoDir);
      options.appendAudit?.(this.buildAuditAction('sync_push', 'git push completed', before, commit));
      return { ok: true, message: 'pushed', commit };
    });
  }

  private hasUpstream(): boolean {
    try {
      git(this.repoDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      return true;
    } catch {
      return false;
    }
  }

  async checkout(ref: string, options: GitChangeOptions = {}): Promise<SyncResult> {
    return this.lock.withLock(() => {
      const before = this.safeCurrentCommit();
      git(this.repoDir, ['checkout', ref]);
      const after = currentCommit(this.repoDir);
      this.afterGitChange('checkout', `checked out ${ref}`, before, after, options);
      return { ok: true, message: `checked out ${ref}`, commit: after, previousCommit: before };
    });
  }

  async rollback(opts: RollbackOptions): Promise<SyncResult> {
    return this.lock.withLock(() => {
      const mode = opts.mode ?? 'checkout';
      const before = this.safeCurrentCommit();
      if (mode === 'revert') {
        git(this.repoDir, ['revert', '--no-edit', `${opts.toCommit}..HEAD`]);
        const after = currentCommit(this.repoDir);
        this.afterGitChange('rollback', `reverted to ${opts.toCommit}`, before, after, opts);
        return { ok: true, message: `reverted to ${opts.toCommit}`, commit: after, previousCommit: before };
      }
      git(this.repoDir, ['checkout', opts.toCommit]);
      const after = currentCommit(this.repoDir);
      this.afterGitChange('rollback', `checked out ${opts.toCommit}`, before, after, opts);
      return { ok: true, message: `checked out ${opts.toCommit}`, commit: after, previousCommit: before };
    });
  }

  validate(): ValidateReport {
    return validateMemoryRepo(this.repoDir);
  }

  private buildCommitMessage(opts: CommitOptions): string {
    const lines = [opts.message, ''];
    if (opts.reviewer) lines.push(`AI-Reviewer: ${opts.reviewer}`);
    if (opts.decision) lines.push(`Decision: ${opts.decision}`);
    if (opts.confidence !== undefined) lines.push(`Confidence: ${opts.confidence}`);
    if (opts.scope) lines.push(`Scope: ${opts.scope}`);
    if (opts.sourceSession) lines.push(`Source-Session: ${opts.sourceSession}`);
    return lines.join('\n').trimEnd();
  }

  private safeCurrentCommit(): string | undefined {
    try {
      return currentCommit(this.repoDir);
    } catch {
      return undefined;
    }
  }

  private afterGitChange(
    action: AuditAction['action'],
    reason: string,
    before: string | undefined,
    after: string,
    options: GitChangeOptions,
  ): void {
    options.rebuildIndex?.();
    options.appendAudit?.(this.buildAuditAction(action, reason, before, after));
  }

  private buildAuditAction(
    action: AuditAction['action'],
    reason: string,
    before: string | undefined,
    after: string,
  ): AuditAction {
    return {
      id: `audit.${Date.now()}`,
      memoryId: 'git.remote',
      action,
      actorType: 'system',
      actorId: 'i-evolve-git-sync',
      reason,
      confidence: 1,
      beforeHash: before,
      afterHash: after,
      sourceRefs: before ? [before, after] : [after],
      policyChecks: [{ policy: 'git_workspace_lock', passed: true }],
      createdAt: new Date().toISOString(),
    };
  }
}

export { GitError };
