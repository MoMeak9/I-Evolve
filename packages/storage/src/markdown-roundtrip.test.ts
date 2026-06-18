import { describe, it, expect } from 'vitest';
import { serializeFrontmatter } from './markdown-writer.js';
import { parseMemoryMarkdown } from './markdown-reader.js';

/** Serialize frontmatter, wrap as a memory file, parse it back. */
function roundTrip(fm: Record<string, unknown>): Record<string, unknown> {
  const md = `${serializeFrontmatter(fm)}\n\nbody\n`;
  return parseMemoryMarkdown(md).frontmatter;
}

describe('frontmatter string round-trip', () => {
  it('keeps number-like source_refs as strings', () => {
    // "4248629" (pure int) and "10e3758" (looks like sci-notation) previously
    // read back as numbers, failing the source_refs: string[] schema.
    const refs = ['4248629', '10e3758', '336e823', 'packages/extensions/link/src/link.ts'];
    const out = roundTrip({ source_refs: refs });
    expect(out.source_refs).toEqual(refs);
    for (const r of out.source_refs as unknown[]) expect(typeof r).toBe('string');
  });

  it('keeps a number-like string scalar as a string', () => {
    const out = roundTrip({ id: '123', title: '1.0' });
    expect(out.id).toBe('123');
    expect(out.title).toBe('1.0');
  });

  it('still parses genuine numbers and booleans as their type', () => {
    const out = roundTrip({ confidence: 0.88, revision: 1, active: true });
    expect(out.confidence).toBe(0.88);
    expect(out.revision).toBe(1);
    expect(out.active).toBe(true);
  });

  it('leaves non-number-like strings unquoted and intact', () => {
    const out = roundTrip({ created_at: '2026-06-18T10:20:58.276Z', domain: 'bilibili' });
    expect(out.created_at).toBe('2026-06-18T10:20:58.276Z');
    expect(out.domain).toBe('bilibili');
  });
});
