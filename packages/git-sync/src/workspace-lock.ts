import { openSync, closeSync, existsSync, unlinkSync, mkdirSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Git workspace lock at {repoDir}/.git/i-evolve.lock.
 * All git operations (pull/push/commit/checkout/rollback/migration) must hold it.
 */
export class GitWorkspaceLock {
  private lockPath: string;

  constructor(repoDir: string) {
    this.lockPath = join(repoDir, '.git', 'i-evolve.lock');
  }

  acquire(): boolean {
    const dir = dirname(this.lockPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      const fd = openSync(this.lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  release(): void {
    if (existsSync(this.lockPath)) {
      try { unlinkSync(this.lockPath); } catch { /* best effort */ }
    }
  }

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    if (!this.acquire()) {
      throw new Error('Git workspace is locked by another i-evolve operation.');
    }
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
