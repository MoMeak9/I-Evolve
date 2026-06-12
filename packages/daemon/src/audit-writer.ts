import { existsSync, mkdirSync, openSync, writeSync, fdatasyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.js';
import { validateAuditAction } from '@i-evolve/schema';
import { mapKeysCamelToSnake } from '@i-evolve/schema';
import type { AuditAction } from '@i-evolve/core';
import { SchemaValidationError } from '@i-evolve/shared';

export class AuditWriter {
  private ensuredDir = false;

  append(action: AuditAction): void {
    const snakeData = mapKeysCamelToSnake(action as unknown as Record<string, unknown>);
    const result = validateAuditAction(snakeData);
    if (!result.valid) {
      throw new SchemaValidationError('Invalid audit action', result.errors);
    }

    const line = JSON.stringify(action) + '\n';
    this.ensureDir();

    const fd = openSync(paths.audit.current, 'a');
    try {
      writeSync(fd, line);
      fdatasyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private ensureDir(): void {
    if (this.ensuredDir) return;
    const dir = dirname(paths.audit.current);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.ensuredDir = true;
  }
}
