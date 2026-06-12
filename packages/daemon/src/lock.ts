import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, existsSync, constants } from 'node:fs';
import { paths } from './paths.js';

export class ProcessLock {
  private fd: number | null = null;

  acquire(): { acquired: boolean; stalePid?: number } {
    if (existsSync(paths.runtime.lock)) {
      const existingPid = this.readPid();
      if (existingPid !== null && this.isProcessAlive(existingPid)) {
        return { acquired: false, stalePid: undefined };
      }
      return { acquired: false, stalePid: existingPid ?? undefined };
    }

    try {
      this.fd = openSync(paths.runtime.lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      const pid = process.pid;
      writeFileSync(paths.runtime.pid, String(pid));
      writeFileSync(this.fd, String(pid));
      closeSync(this.fd);
      this.fd = null;
      return { acquired: true };
    } catch {
      return { acquired: false };
    }
  }

  release(): void {
    try {
      if (existsSync(paths.runtime.lock)) unlinkSync(paths.runtime.lock);
      if (existsSync(paths.runtime.pid)) unlinkSync(paths.runtime.pid);
    } catch {
      // best effort
    }
  }

  repair(): void {
    this.release();
  }

  private readPid(): number | null {
    try {
      const content = readFileSync(paths.runtime.lock, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return Number.isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
