import { existsSync } from 'node:fs';
import { git, isClean, currentCommit, GitError } from './git.js';
import { GitWorkspaceLock } from './workspace-lock.js';
import { validateMemoryRepo, type ValidateReport } from './validate.js';

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
}

export interface SyncResult {
  ok: boolean;
  message: string;
  commit?: string;
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

  async pull(): Promise<SyncResult> {
    return this.lock.withLock(() => {
      if (!isClean(this.repoDir)) {
        return { ok: false, message: 'working tree not clean; refusing to pull' };
      }
      git(this.repoDir, ['fetch', 'origin']);
      try {
        git(this.repoDir, ['pull', '--ff-only']);
      } catch (err) {
        return { ok: false, message: `pull failed (conflict?): ${(err as Error).message}` };
      }
      return { ok: true, message: 'pulled', commit: currentCommit(this.repoDir) };
    });
  }

  async push(): Promise<SyncResult> {
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
      return { ok: true, message: 'pushed', commit: currentCommit(this.repoDir) };
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

  async checkout(ref: string): Promise<SyncResult> {
    return this.lock.withLock(() => {
      git(this.repoDir, ['checkout', ref]);
      return { ok: true, message: `checked out ${ref}`, commit: currentCommit(this.repoDir) };
    });
  }

  async rollback(opts: RollbackOptions): Promise<SyncResult> {
    return this.lock.withLock(() => {
      const mode = opts.mode ?? 'checkout';
      if (mode === 'revert') {
        git(this.repoDir, ['revert', '--no-edit', `${opts.toCommit}..HEAD`]);
        return { ok: true, message: `reverted to ${opts.toCommit}`, commit: currentCommit(this.repoDir) };
      }
      git(this.repoDir, ['checkout', opts.toCommit]);
      return { ok: true, message: `checked out ${opts.toCommit}`, commit: currentCommit(this.repoDir) };
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
}

export { GitError };
