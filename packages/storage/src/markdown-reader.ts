import { readFileSync } from 'node:fs';

export interface ParsedMemoryFile {
  frontmatter: Record<string, unknown>;
  content: string;
}

export function parseMemoryFile(filePath: string): ParsedMemoryFile {
  const raw = readFileSync(filePath, 'utf-8');
  return parseMemoryMarkdown(raw);
}

export function parseMemoryMarkdown(raw: string): ParsedMemoryFile {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid memory markdown: missing frontmatter delimiters');
  }
  const [, yamlBlock, content] = match;
  const frontmatter = parseYaml(yamlBlock);
  return { frontmatter, content: content.trim() };
}

function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < 0) { i++; continue; }

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) { i++; continue; }

    const [, , key, value] = match;
    const trimmedKey = key.trim();

    if (value === '' || value === undefined) {
      // Could be an object or array
      const nextIndent = getNextContentIndent(lines, i + 1);
      if (nextIndent > indent) {
        const nextLine = lines[i + 1]?.trimStart();
        if (nextLine?.startsWith('- ')) {
          const [arr, consumed] = parseArray(lines, i + 1, nextIndent);
          result[trimmedKey] = arr;
          i = consumed;
        } else {
          const [obj, consumed] = parseObject(lines, i + 1, nextIndent);
          result[trimmedKey] = obj;
          i = consumed;
        }
      } else {
        result[trimmedKey] = null;
        i++;
      }
    } else {
      result[trimmedKey] = parseValue(value);
      i++;
    }
  }

  return result;
}

function parseArray(lines: string[], start: number, baseIndent: number): [unknown[], number] {
  const arr: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < 0) { i++; continue; }
    if (indent < baseIndent) break;

    const trimmed = line.trimStart();
    if (!trimmed.startsWith('- ')) break;

    const value = trimmed.slice(2);
    if (value === '' || value.includes(':')) {
      // nested object in array
      const nextIndent = getNextContentIndent(lines, i + 1);
      if (nextIndent > indent) {
        const [obj, consumed] = parseObject(lines, i + 1, nextIndent);
        arr.push(obj);
        i = consumed;
      } else {
        arr.push(value ? parseValue(value) : null);
        i++;
      }
    } else {
      arr.push(parseValue(value));
      i++;
    }
  }

  return [arr, i];
}

function parseObject(lines: string[], start: number, baseIndent: number): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < 0) { i++; continue; }
    if (indent < baseIndent) break;

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) { i++; continue; }

    const [, , key, value] = match;
    const trimmedKey = key.trim();

    if (value === '' || value === undefined) {
      const nextIndent = getNextContentIndent(lines, i + 1);
      if (nextIndent > indent) {
        const nextLine = lines[i + 1]?.trimStart();
        if (nextLine?.startsWith('- ')) {
          const [arr, consumed] = parseArray(lines, i + 1, nextIndent);
          obj[trimmedKey] = arr;
          i = consumed;
        } else {
          const [nested, consumed] = parseObject(lines, i + 1, nextIndent);
          obj[trimmedKey] = nested;
          i = consumed;
        }
      } else {
        obj[trimmedKey] = null;
        i++;
      }
    } else {
      obj[trimmedKey] = parseValue(value);
      i++;
    }
  }

  return [obj, i];
}

function getNextContentIndent(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    const indent = lines[i].search(/\S/);
    if (indent >= 0) return indent;
  }
  return -1;
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === '[]') return [];
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') return num;
  return trimmed;
}
