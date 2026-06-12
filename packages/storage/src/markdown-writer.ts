import { writeFileSync, renameSync, mkdirSync, existsSync, openSync, fdatasyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { camelToSnake } from '@i-evolve/schema';

export interface MemoryFrontmatter {
  [key: string]: unknown;
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    lines.push(serializeField(key, value, 0));
  }
  lines.push('---');
  return lines.join('\n');
}

function serializeField(key: string, value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return `${pad}${key}:`;
  if (typeof value === 'string') return `${pad}${key}: ${value}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${pad}${key}: ${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []`;
    const items = value.map((v) => {
      if (typeof v === 'object' && v !== null) {
        const inner = Object.entries(v).map(([k, iv]) => serializeField(k, iv, indent + 2)).join('\n');
        return `${pad}  -\n${inner}`;
      }
      return `${pad}  - ${v}`;
    });
    return `${pad}${key}:\n${items.join('\n')}`;
  }
  if (typeof value === 'object') {
    const inner = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => serializeField(k, v, indent + 1))
      .join('\n');
    return `${pad}${key}:\n${inner}`;
  }
  return `${pad}${key}: ${String(value)}`;
}

export function buildMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  return `${serializeFrontmatter(frontmatter)}\n\n${content}\n`;
}

export function computeContentHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpPath = `${targetPath}.tmp-${Date.now()}`;
  writeFileSync(tmpPath, content, 'utf-8');

  // fsync the temp file
  const fd = openSync(tmpPath, 'r');
  fdatasyncSync(fd);
  closeSync(fd);

  // atomic rename
  renameSync(tmpPath, targetPath);

  // fsync parent directory
  const dirFd = openSync(dir, 'r');
  fdatasyncSync(dirFd);
  closeSync(dirFd);
}
