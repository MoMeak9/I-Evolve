import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryMarkdown } from '@i-evolve/storage';
import { validateMemory, detectCamelCaseKeys } from '@i-evolve/schema';
import { computeContentHash } from '@i-evolve/storage';

export interface ValidateIssue {
  file: string;
  problem: string;
}

export interface ValidateReport {
  ok: boolean;
  checkedFiles: number;
  issues: ValidateIssue[];
}

const SECRET_RE = /(AKIA[0-9A-Z]{16})|(-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)|((?:ghp|sk|xoxb)[-_][A-Za-z0-9_-]{16,})/;
const PII_RE = /(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)|(\b(?:\d{1,3}\.){3}\d{1,3}\b)|(\b(?:\+?\d{1,3}[-\s]?)?(?:\d{3}[-\s]?){2}\d{4}\b)/;

export interface ValidateOptions {
  now?: string;
}

/**
 * Validate a memory repo before push: memory-pack.yaml exists, all markdown
 * frontmatter valid, ids unique, no secrets, no camelCase frontmatter keys.
 */
export function validateMemoryRepo(repoDir: string, options: ValidateOptions = {}): ValidateReport {
  const issues: ValidateIssue[] = [];
  let checkedFiles = 0;

  const packPath = join(repoDir, 'memory-pack.yaml');
  if (!existsSync(packPath)) {
    issues.push({ file: 'memory-pack.yaml', problem: 'missing memory-pack.yaml' });
  } else {
    validatePack(packPath, issues);
  }

  const seenIds = new Set<string>();
  const tombstoneIds = readTombstoneIds(repoDir);
  const now = options.now ? Date.parse(options.now) : Date.now();

  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === '.git' || entry === 'tombstones' || entry === 'audit' || entry === 'migrations') continue;
        scan(full);
      } else if (entry.endsWith('.md') && entry !== 'README.md' && entry !== 'CHANGELOG.md' && entry !== 'project-profile.md') {
        checkedFiles++;
        validateFile(full, repoDir, seenIds, tombstoneIds, now, issues);
      }
    }
  };

  scan(repoDir);

  return { ok: issues.length === 0, checkedFiles, issues };
}

function validatePack(packPath: string, issues: ValidateIssue[]): void {
  const raw = readFileSync(packPath, 'utf-8');
  const m = raw.match(/^schema_version:\s*(.+)$/m);
  if (!m) {
    issues.push({ file: 'memory-pack.yaml', problem: 'schema_version missing' });
    return;
  }
  const parsed = Number(m[1].trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push({ file: 'memory-pack.yaml', problem: 'schema_version is not recognized' });
  }
}

function readTombstoneIds(repoDir: string): Set<string> {
  const ids = new Set<string>();
  const tombstoneDir = join(repoDir, 'tombstones');
  if (!existsSync(tombstoneDir)) return ids;

  const scan = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        scan(full);
      } else if (entry.endsWith('.md')) {
        ids.add(entry.slice(0, -3));
      }
    }
  };
  scan(tombstoneDir);
  return ids;
}

function validateFile(
  full: string,
  repoDir: string,
  seenIds: Set<string>,
  tombstoneIds: Set<string>,
  now: number,
  issues: ValidateIssue[],
): void {
  const rel = full.slice(repoDir.length + 1);
  let raw: string;
  try {
    raw = readFileSync(full, 'utf-8');
  } catch {
    issues.push({ file: rel, problem: 'cannot read file' });
    return;
  }

  if (SECRET_RE.test(raw)) {
    issues.push({ file: rel, problem: 'contains a possible secret' });
  }
  if (PII_RE.test(raw)) {
    issues.push({ file: rel, problem: 'contains possible PII' });
  }

  let parsed;
  try {
    parsed = parseMemoryMarkdown(raw);
  } catch (err) {
    issues.push({ file: rel, problem: `parse error: ${(err as Error).message}` });
    return;
  }

  const camel = detectCamelCaseKeys(parsed.frontmatter);
  if (camel.length > 0) {
    issues.push({ file: rel, problem: `camelCase frontmatter keys: ${camel.join(', ')}` });
  }

  const result = validateMemory(parsed.frontmatter);
  if (!result.valid) {
    issues.push({ file: rel, problem: `schema: ${result.errors.map((e) => e.message).join(', ')}` });
  }

  const id = parsed.frontmatter.id as string | undefined;
  if (id) {
    if (seenIds.has(id)) {
      issues.push({ file: rel, problem: `duplicate id: ${id}` });
    }
    if (tombstoneIds.has(id)) {
      issues.push({ file: rel, problem: `active memory reuses tombstone id: ${id}` });
    }
    seenIds.add(id);
  }

  const hash = parsed.frontmatter.content_hash as string | undefined;
  if (hash && !hash.startsWith('sha256:')) {
    issues.push({ file: rel, problem: 'content_hash not sha256-prefixed' });
  } else if (hash && hash !== computeContentHash(parsed.content)) {
    issues.push({ file: rel, problem: 'content_hash mismatch' });
  }

  if (parsed.frontmatter.status === 'active' && typeof parsed.frontmatter.expires_at === 'string') {
    const expires = Date.parse(parsed.frontmatter.expires_at);
    if (!Number.isNaN(expires) && expires <= now) {
      issues.push({ file: rel, problem: 'active memory expired' });
    }
  }
}
