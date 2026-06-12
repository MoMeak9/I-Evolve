import { existsSync } from 'node:fs';
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

  isInitialized(): boolean {
    return existsSync(`${this.repoDir}/.git`);
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
      if (this.hasUpstream()) {
        git(this.repoDir, ['push']);
      } else {
        const branch = git(this.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
        git(this.repoDir, ['push', '-u', 'origin', branch]);
      }
      const commit = currentCommit(this.repoDir);
      options.appendAudit?.(this.buildAuditAction('sync_push', 'git push completed', commit, commit));
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
