const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'bearer_token', re: /\b(?:ghp|gho|github_pat|sk|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}\b/g },
  { name: 'generic_secret', re: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}['"]?/gi },
];

const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'ipv4', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'phone', re: /\b(?:\+?\d{1,3}[-\s]?)?(?:\d{3}[-\s]?){2}\d{4}\b/g },
];

export interface RedactionResult {
  text: string;
  secretsFound: string[];
  piiFound: string[];
}

export function redact(input: string): RedactionResult {
  let text = input;
  const secretsFound: string[] = [];
  const piiFound: string[] = [];

  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) {
      secretsFound.push(name);
      text = text.replace(re, `[REDACTED:${name}]`);
    }
  }
  for (const { name, re } of PII_PATTERNS) {
    if (re.test(text)) {
      piiFound.push(name);
      text = text.replace(re, `[REDACTED:${name}]`);
    }
  }

  return { text, secretsFound, piiFound };
}

export function containsSecret(input: string): boolean {
  return SECRET_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}

export function containsPii(input: string): boolean {
  return PII_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}
