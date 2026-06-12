import { appendFileSync, mkdirSync, existsSync, fdatasyncSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.js';
import { validateObservation } from '@i-evolve/schema';
import { mapKeysCamelToSnake } from '@i-evolve/schema';
import type { Observation } from '@i-evolve/core';
import { SchemaValidationError } from '@i-evolve/shared';

export class ObservationWriter {
  private ensuredDir = false;

  append(observation: Observation): void {
    const snakeData = mapKeysCamelToSnake(observation as unknown as Record<string, unknown>);
    const result = validateObservation(snakeData);
    if (!result.valid) {
      throw new SchemaValidationError('Invalid observation', result.errors);
    }

    const line = JSON.stringify({ ...observation, received_at: new Date().toISOString() }) + '\n';
    this.ensureDir();

    const fd = openSync(paths.observations.current, 'a');
    try {
      writeSync(fd, line);
      fdatasyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private ensureDir(): void {
    if (this.ensuredDir) return;
    const dir = dirname(paths.observations.current);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.ensuredDir = true;
  }
}
