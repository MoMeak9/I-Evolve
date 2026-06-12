import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import memorySchema from '../schemas/memory.schema.json' with { type: 'json' };
import observationSchema from '../schemas/observation.schema.json' with { type: 'json' };
import auditActionSchema from '../schemas/audit-action.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateMemoryFn = ajv.compile(memorySchema);
const validateObservationFn = ajv.compile(observationSchema);
const validateAuditActionFn = ajv.compile(auditActionSchema);

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

function toResult(valid: boolean, errors: typeof validateMemoryFn.errors): ValidationResult {
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (errors ?? []).map((e) => ({
      path: e.instancePath || '/',
      message: e.message ?? 'unknown error',
    })),
  };
}

export function validateMemory(data: unknown): ValidationResult {
  const valid = validateMemoryFn(data);
  return toResult(valid, validateMemoryFn.errors);
}

export function validateObservation(data: unknown): ValidationResult {
  const valid = validateObservationFn(data);
  return toResult(valid, validateObservationFn.errors);
}

export function validateAuditAction(data: unknown): ValidationResult {
  const valid = validateAuditActionFn(data);
  return toResult(valid, validateAuditActionFn.errors);
}

export function detectCamelCaseKeys(data: Record<string, unknown>): string[] {
  const camelCasePattern = /[a-z][A-Z]/;
  return Object.keys(data).filter((key) => camelCasePattern.test(key));
}

export const schemas = {
  memory: memorySchema,
  observation: observationSchema,
  'audit-action': auditActionSchema,
} as const;

export type SchemaName = keyof typeof schemas;
