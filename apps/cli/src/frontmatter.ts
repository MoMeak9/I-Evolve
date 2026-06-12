export function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error('No YAML frontmatter found');
  }
  const yamlStr = match[1];
  return parseSimpleYaml(yamlStr);
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (!match) { i++; continue; }

    const [, key, value] = match;

    if (value === '' && i + 1 < lines.length && lines[i + 1].match(/^\s+-/)) {
      const arr: unknown[] = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-/)) {
        const itemMatch = lines[i].match(/^\s+-\s*(.*)/);
        if (itemMatch) arr.push(parseValue(itemMatch[1]));
        i++;
      }
      result[key] = arr;
    } else if (value === '' && i + 1 < lines.length && lines[i + 1].match(/^\s+\w/)) {
      const nested: Record<string, unknown> = {};
      i++;
      while (i < lines.length && lines[i].match(/^\s+\w/)) {
        const nestedLine = lines[i].trim();
        const nestedMatch = nestedLine.match(/^(\w[\w_]*):\s*(.*)/);
        if (nestedMatch) {
          const [, nKey, nValue] = nestedMatch;
          if (nValue === '' && i + 1 < lines.length && lines[i + 1].match(/^\s{4,}-/)) {
            const arr: string[] = [];
            i++;
            while (i < lines.length && lines[i].match(/^\s{4,}-/)) {
              const aMatch = lines[i].match(/^\s+-\s*(.*)/);
              if (aMatch) arr.push(aMatch[1].replace(/^["']|["']$/g, ''));
              i++;
            }
            nested[nKey] = arr;
          } else {
            nested[nKey] = parseValue(nValue);
            i++;
          }
        } else {
          i++;
        }
      }
      result[key] = nested;
    } else {
      result[key] = parseValue(value);
      i++;
    }
  }
  return result;
}

function parseValue(str: string): unknown {
  str = str.trim();
  if (str === 'null' || str === '~') return null;
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  return str.replace(/^["']|["']$/g, '');
}
