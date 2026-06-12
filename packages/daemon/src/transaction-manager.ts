import { randomUUID } from 'node:crypto';
import type { Transaction } from '@i-evolve/repository';

export interface TransactionOptions {
  name: string;
  timeout?: number;
}

export class SerialTransactionManager {
  private queue: Array<() => void> = [];
  private running = false;

  async run<T>(
    name: string,
    options: TransactionOptions,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    await this.acquireSlot();
    const tx = new LocalTransaction(name);
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (!this.running) {
      this.running = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.running = false;
    }
  }
}

class LocalTransaction implements Transaction {
  readonly id: string;
  private committed = false;
  private rolledBack = false;

  constructor(public readonly name: string) {
    this.id = randomUUID();
  }

  async commit(): Promise<void> {
    if (this.rolledBack) throw new Error(`Transaction ${this.id} already rolled back`);
    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed) throw new Error(`Transaction ${this.id} already committed`);
    this.rolledBack = true;
  }
}
