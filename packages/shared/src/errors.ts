export class IEvolveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'IEvolveError';
  }
}

export class SchemaValidationError extends IEvolveError {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>,
  ) {
    super(message, 'SCHEMA_VALIDATION_ERROR');
    this.name = 'SchemaValidationError';
  }
}

export class MemoryNotFoundError extends IEvolveError {
  constructor(id: string) {
    super(`Memory not found: ${id}`, 'MEMORY_NOT_FOUND');
    this.name = 'MemoryNotFoundError';
  }
}

export class ConcurrencyConflictError extends IEvolveError {
  constructor(id: string) {
    super(`Concurrency conflict on: ${id}`, 'CONCURRENCY_CONFLICT');
    this.name = 'ConcurrencyConflictError';
  }
}
