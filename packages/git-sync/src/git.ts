import { execFileSync } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a git command in the given working directory.
 * Uses execFileSync with an argument array (no shell) to avoid injection.
 */
export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr ? e.stderr.toString() : (e.message ?? 'git error');
    throw new GitError(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export function isClean(cwd: string): boolean {
  const status = git(cwd, ['status', '--porcelain']);
  return status.length === 0;
}

export function currentCommit(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']);
}
