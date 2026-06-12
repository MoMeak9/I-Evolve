#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateMemory, validateObservation, validateAuditAction, detectCamelCaseKeys, schemas } from '@i-evolve/schema';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
    bootstrap: { type: 'boolean' },
  },
});

const [command, subcommand, ...rest] = positionals;

if (values.version) {
  console.log('i-evolve 0.0.0');
  process.exit(0);
}

if (values.help || !command) {
  console.log(`Usage: i-evolve <command> [options]

Commands:
  schema validate <file>   Validate a YAML/JSON file against its schema
  schema print <name>      Print a JSON schema (memory | observation | audit-action)
  doctor --bootstrap       Check system health`);
  process.exit(0);
}

if (command === 'schema' && subcommand === 'validate') {
  const file = rest[0];
  if (!file) {
    console.error('Error: file path required');
    process.exit(1);
  }

  const filePath = resolve(file);
  const raw = readFileSync(filePath, 'utf-8');
  let data: Record<string, unknown>;

  if (filePath.endsWith('.json')) {
    data = JSON.parse(raw);
  } else {
    const { parseFrontmatter } = await import('./frontmatter.js');
    data = parseFrontmatter(raw);
  }

  const camelKeys = detectCamelCaseKeys(data);
  if (camelKeys.length > 0) {
    console.error(`Error: camelCase keys detected in frontmatter. Use snake_case instead.`);
    console.error(`  Found: ${camelKeys.join(', ')}`);
    process.exit(1);
  }

  const schemaName = detectSchemaType(data);
  const validators: Record<string, (d: unknown) => { valid: boolean; errors: Array<{ path: string; message: string }> }> = {
    memory: validateMemory,
    observation: validateObservation,
    'audit-action': validateAuditAction,
  };

  const validator = validators[schemaName];
  if (!validator) {
    console.error(`Error: cannot determine schema type for file`);
    process.exit(1);
  }

  const result = validator(data);
  if (result.valid) {
    console.log(`Valid ${schemaName} document.`);
  } else {
    console.error(`Validation failed for ${schemaName}:`);
    for (const err of result.errors) {
      console.error(`  ${err.path}: ${err.message}`);
    }
    process.exit(1);
  }
} else if (command === 'schema' && subcommand === 'print') {
  const name = rest[0] as keyof typeof schemas | undefined;
  if (!name || !(name in schemas)) {
    console.error(`Error: unknown schema. Available: ${Object.keys(schemas).join(', ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify(schemas[name], null, 2));
} else if (command === 'doctor') {
  console.log('i-evolve doctor');
  console.log('  Node.js:', process.version);
  console.log('  Platform:', process.platform);
  if (values.bootstrap) {
    console.log('  Bootstrap: OK (nothing to do in MVP0)');
  }
} else {
  console.error(`Unknown command: ${command} ${subcommand ?? ''}`);
  process.exit(1);
}

function detectSchemaType(data: Record<string, unknown>): string {
  if ('memory_id' in data && 'action' in data && 'actor_type' in data) return 'audit-action';
  if ('session_id' in data && 'phase' in data) return 'observation';
  return 'memory';
}
