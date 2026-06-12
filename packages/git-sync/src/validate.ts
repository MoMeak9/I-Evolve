import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryMarkdown } from '@i-evolve/storage';
import { validateMemory, detectCamelCaseKeys } from '@i-evolve/schema';

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

/**
 * Validate a memory repo before push: memory-pack.yaml exists, all markdown
 * frontmatter valid, ids unique, no secrets, no camelCase frontmatter keys.
 */
export function validateMemoryRepo(repoDir: string): ValidateReport {
  const issues: ValidateIssue[] = [];
  let checkedFiles = 0;

  if (!existsSync(join(repoDir, 'memory-pack.yaml'))) {
    issues.push({ file: 'memory-pack.yaml', problem: 'missing memory-pack.yaml' });
  }

  const seenIds = new Set<string>();

  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === '.git' || entry === 'tombstones' || entry === 'audit' || entry === 'migrations') continue;
        scan(full);
      } else if (entry.endsWith('.md') && entry !== 'README.md' && entry !== 'CHANGELOG.md') {
        checkedFiles++;
        validateFile(full, repoDir, seenIds, issues);
      }
    }
  };

  scan(repoDir);

  return { ok: issues.length === 0, checkedFiles, issues };
}

function validateFile(full: string, repoDir: string, seenIds: Set<string>, issues: ValidateIssue[]): void {
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
    seenIds.add(id);
  }

  // content_hash sanity (must be present; deep verify is best-effort)
  const hash = parsed.frontmatter.content_hash as string | undefined;
  if (hash && !hash.startsWith('sha256:')) {
    issues.push({ file: rel, problem: 'content_hash not sha256-prefixed' });
  }
}
