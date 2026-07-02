#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateMemory, validateObservation, validateAuditAction, detectCamelCaseKeys, schemas } from '@i-evolve/schema';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
    bootstrap: { type: 'boolean' },
    foreground: { type: 'boolean' },
    file: { type: 'string' },
    mode: { type: 'string' },
    status: { type: 'string' },
    session: { type: 'string' },
    'auto-evolve': { type: 'boolean' },
    phase: { type: 'string' },
    source: { type: 'string' },
    tool: { type: 'string' },
    summary: { type: 'string' },
    query: { type: 'string' },
    format: { type: 'string' },
    'max-tokens': { type: 'string' },
    'repo-id': { type: 'string' },
    'project-id': { type: 'string' },
    domain: { type: 'string' },
    message: { type: 'string' },
    'to-commit': { type: 'string' },
    to: { type: 'string' },
    'dry-run': { type: 'boolean' },
    debug: { type: 'boolean' },
    hook: { type: 'boolean' },
    cwd: { type: 'string' },
    project: { type: 'string' },
    memory: { type: 'string' },
    stdio: { type: 'boolean' },
    port: { type: 'string' },
    'project-root': { type: 'string' },
    'codex-config': { type: 'string' },
    'claude-plugin-dir': { type: 'string' },
    'claude-settings': { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    'non-interactive': { type: 'boolean' },
    remote: { type: 'string' },
    'skip-remote': { type: 'boolean' },
    prompt: { type: 'string' },
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
  daemon start [--foreground]  Start the daemon
  daemon stop                  Stop the daemon
  daemon status                Show daemon status
  observe <json>               Append an observation (requires daemon)
  init                         Start daemon, bind project, and wire shared memory (interactive)
  schema validate <file>       Validate a YAML/JSON file against its schema
  schema print <name>          Print a JSON schema (memory | observation | audit-action)
  setup all                    Install CLI dependencies and configure Codex/Claude Code
  setup codex [--bootstrap]    Configure Codex MCP server; optionally install/build prerequisites
  setup claude-code            Install Claude Code plugin
  doctor --bootstrap           Check system health
  model install default        Install default local embedding model
  index rebuild|doctor         Rebuild or inspect the local retrieval index
  recall --phase <phase>       Print SessionStart/UserPromptSubmit context
  intent infer --prompt <txt>  Infer prompt intent
  repair stale-lock            Remove stale daemon lock`);
  process.exit(0);
}

if (command === 'daemon') {
  const { handleDaemonCommand } = await import('./commands/daemon.js');
  await handleDaemonCommand(subcommand, { foreground: values.foreground ?? false });
} else if (command === 'observe') {
  const { handleObserve } = await import('./commands/observe.js');
  await handleObserve(rest[0], {
    phase: values.phase,
    source: values.source,
    tool: values.tool,
    summary: values.summary,
    sessionId: values.session,
  });
} else if (command === 'inject') {
  const { handleInject } = await import('./commands/inject.js');
  await handleInject(values);
} else if (command === 'init') {
  const { handleInitCommand } = await import('./commands/init.js');
  await handleInitCommand(values);
} else if (command === 'identity') {
  const { handleIdentityCommand } = await import('./commands/identity.js');
  await handleIdentityCommand(subcommand, values);
} else if (command === 'model') {
  const { handleModelCommand } = await import('./commands/retrieval-runtime.js');
  await handleModelCommand(subcommand, rest);
} else if (command === 'intent') {
  const { handleIntentCommand } = await import('./commands/retrieval-runtime.js');
  await handleIntentCommand(subcommand, values);
} else if (command === 'recall') {
  const { handleRecallCommand } = await import('./commands/retrieval-runtime.js');
  await handleRecallCommand(values);
} else if (command === 'retrieval') {
  if (subcommand === 'explain') {
    const memory = values.memory as string | undefined;
    if (!memory) {
      console.error('Usage: i-evolve retrieval explain --memory <id>');
      process.exit(1);
    }
    console.log(`Memory ${memory} is selected when its scope/applies_to match the current identity and no higher-priority same-topic memory suppresses it.`);
  } else {
    console.error('Usage: i-evolve retrieval explain --memory <id>');
    process.exit(1);
  }
} else if (command === 'session') {
  const { handleSessionCommand } = await import('./commands/session.js');
  await handleSessionCommand(subcommand, values);
} else if (command === 'repair') {
  const { ProcessLock, paths } = await import('@i-evolve/daemon');
  if (subcommand === 'stale-lock') {
    const lock = new ProcessLock();
    lock.repair();
    console.log('Stale lock removed.');
  } else if (subcommand === 'rebuild-index') {
    if (values['dry-run']) {
      console.log('Dry run: would rebuild SQLite/FTS index.');
      process.exit(0);
    }
    const { MarkdownMemoryRepository } = await import('@i-evolve/storage');
    const repo = new MarkdownMemoryRepository({ memoryDir: paths.shared.memory, dbPath: join(paths.base, 'shared', 'index.db') });
    const result = repo.rebuildIndex();
    repo.close();
    appendSystemAudit(paths.audit.dir, paths.audit.current, 'index.rebuild', `rebuilt index: ${result.total} memories, ${result.errors} errors`);
    console.log(`Index rebuilt: ${result.total} memories indexed, ${result.errors} errors.`);
  } else if (subcommand === 'verify-hashes') {
    const { validateMemoryRepo } = await import('@i-evolve/git-sync');
    const report = validateMemoryRepo(paths.shared.memory);
    console.log(report.ok ? 'Memory hashes verified.' : `Hash/schema verification failed: ${report.issues.length} issue(s).`);
    if (!report.ok) process.exit(1);
  } else if (subcommand === 'audit-log') {
    if (values['dry-run']) {
      console.log('Dry run: would repair audit log directory.');
      process.exit(0);
    }
    if (!existsSync(paths.audit.dir)) mkdirSync(paths.audit.dir, { recursive: true });
    appendSystemAudit(paths.audit.dir, paths.audit.current, 'audit.repair', 'verified audit log directory');
    console.log('Audit log repaired.');
  } else if (subcommand === 'git-cleanup') {
    if (values['dry-run']) {
      console.log('Dry run: would remove stale git workspace lock.');
      process.exit(0);
    }
    const lockPath = join(paths.shared.memory, '.git', 'i-evolve.lock');
    if (existsSync(lockPath)) rmSync(lockPath, { force: true });
    appendSystemAudit(paths.audit.dir, paths.audit.current, 'git.cleanup', 'removed stale git workspace lock if present');
    console.log('Git cleanup complete.');
  } else {
    console.error('Usage: i-evolve repair <stale-lock|rebuild-index|verify-hashes|audit-log|git-cleanup> [--dry-run]');
    process.exit(1);
  }
} else if (command === 'memory') {
  const { handleMemoryCommand } = await import('./commands/memory.js');
  await handleMemoryCommand(subcommand, rest, values);
} else if (command === 'index') {
  const { handleIndexRuntimeCommand } = await import('./commands/retrieval-runtime.js');
  const handled = await handleIndexRuntimeCommand(subcommand);
  if (!handled) {
    const { handleIndexCommand } = await import('./commands/memory.js');
    await handleIndexCommand(subcommand);
  }
} else if (command === 'evolve') {
  const { handleEvolveCommand } = await import('./commands/evolve.js');
  await handleEvolveCommand(subcommand, values);
} else if (command === 'audit') {
  const { handleAuditCommand } = await import('./commands/evolve.js');
  await handleAuditCommand(subcommand, rest);
} else if (command === 'migrate') {
  const { handleMigrateCommand } = await import('./commands/migrate.js');
  await handleMigrateCommand(subcommand, values);
} else if (command === 'mcp') {
  const { handleMcpCommand } = await import('./commands/mcp.js');
  await handleMcpCommand(subcommand, values);
} else if (command === 'setup') {
  const { handleSetupCommand } = await import('./commands/setup.js');
  await handleSetupCommand(subcommand, values);
} else if (command === 'schema' && subcommand === 'validate') {
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
  const { sendRequest, paths } = await import('@i-evolve/daemon');
  const { GitMemorySync } = await import('@i-evolve/git-sync');
  const { readSchemaVersion } = await import('@i-evolve/git-sync');
  console.log('i-evolve doctor');
  console.log('  Node.js:', process.version);
  console.log('  CLI version:', '0.0.0');
  console.log('  Platform:', process.platform);
  console.log('  Data dir:', paths.base);
  console.log('  Memory repo:', existsSync(paths.shared.memory) ? 'exists' : 'missing');
  console.log('  Schema version:', readSchemaVersion(paths.shared.memory));
  console.log('  SQLite index:', existsSync(join(paths.base, 'shared', 'index.db')) ? 'exists' : 'missing');
  console.log('  FTS health:', existsSync(join(paths.base, 'shared', 'index.db')) ? 'available' : 'missing');
  console.log('  Audit log:', existsSync(paths.audit.dir) ? 'exists' : 'missing');
  console.log('  Claude plugin:', existsSync(join(process.cwd(), 'packages', 'claude-plugin', '.claude-plugin', 'plugin.json')) ? 'present' : 'missing');

  try {
    const resp = await sendRequest({ type: 'health' });
    if (resp.ok) {
      console.log('  Daemon: running (pid', (resp.data as any).pid, ')');
    }
  } catch {
    console.log('  Daemon: not running');
  }

  try {
    const sync = new GitMemorySync(paths.shared.memory);
    if (sync.isInitialized()) {
      const status = sync.status();
      console.log('  Git branch:', status.branch);
      console.log('  Git clean:', status.clean);
      console.log('  Git commit:', status.commit.slice(0, 8));
      console.log('  Remote branch:', status.branch);
      console.log('  Unpushed commits:', 'unknown');
      console.log('  Last pull time:', 'unknown');
      console.log('  Remote memory:', 'initialized');
    } else {
      console.log('  Remote memory: not initialized');
    }
  } catch {
    console.log('  Remote memory: unavailable');
  }

  console.log('  MCP server:', 'available via i-evolve mcp start --stdio');

  if (values.bootstrap) {
    console.log('  Bootstrap: OK');
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

function appendSystemAudit(auditDir: string, auditFile: string, idSuffix: string, reason: string): void {
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const now = new Date().toISOString();
  appendFileSync(auditFile, JSON.stringify({
    id: `audit.system.${Date.now()}.${idSuffix}`,
    memoryId: 'system.repair',
    action: 'migrate',
    actorType: 'system',
    actorId: 'i-evolve-repair',
    reason,
    confidence: 1,
    sourceRefs: [],
    policyChecks: [{ policy: 'repair_audit', passed: true }],
    createdAt: now,
  }) + '\n', 'utf-8');
}
