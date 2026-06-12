import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseMemoryMarkdown } from './markdown-reader.js';

export interface ProjectIdentity {
  repoId: string;
  projectId?: string;
  domain?: string;
  gitRemote?: string;
  packageNames: string[];
  rootPath: string;
  confidence: number;
}

export interface ProjectProfileDocument {
  id: string;
  projectId: string;
  repoIds: string[];
  domains: string[];
  packageNames: string[];
  status: string;
}

export interface DetectProjectIdentityInput {
  cwd: string;
  gitRemote?: string;
  packageNames?: string[];
  profiles?: ProjectProfileDocument[];
  manualProjectId?: string;
  manualDomain?: string;
}

export interface BindProjectIdentityInput {
  memoryDir: string;
  projectId: string;
  repoId: string;
  domain?: string;
  packageNames?: string[];
}

export function normalizeGitRemoteUrl(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const trimmed = remote.trim();
  const ssh = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return ssh[2].replace(/\.git$/, '');
  const https = trimmed.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (https) return https[1].replace(/\.git$/, '');
  return trimmed.replace(/\.git$/, '');
}

export function readProjectProfile(markdown: string): ProjectProfileDocument {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  return {
    id: String(frontmatter.id ?? ''),
    projectId: String(frontmatter.project_id ?? ''),
    repoIds: asStringArray(frontmatter.repo_ids),
    domains: asStringArray(frontmatter.domains),
    packageNames: asStringArray(frontmatter.package_names),
    status: String(frontmatter.status ?? 'active'),
  };
}

export function detectProjectIdentity(input: DetectProjectIdentityInput): ProjectIdentity {
  const rootPath = detectGitRoot(input.cwd) ?? resolve(input.cwd);
  const gitRemote = input.gitRemote ?? detectGitRemote(rootPath);
  const repoId = normalizeGitRemoteUrl(gitRemote) ?? basenameRepo(rootPath);
  const packageNames = dedupe([...(input.packageNames ?? []), ...detectPackageNames(rootPath)]);
  const profile = findMatchingProfile(input.profiles ?? [], repoId, packageNames);

  let confidence = 0.45;
  if (gitRemote) confidence += 0.3;
  if (packageNames.length > 0) confidence += 0.1;
  if (profile) confidence += 0.15;

  return {
    repoId,
    projectId: input.manualProjectId ?? profile?.projectId,
    domain: input.manualDomain ?? profile?.domains[0],
    gitRemote,
    packageNames,
    rootPath,
    confidence: Math.min(1, confidence),
  };
}

function findMatchingProfile(
  profiles: ProjectProfileDocument[],
  repoId: string,
  packageNames: string[],
): ProjectProfileDocument | undefined {
  return profiles.find((p) =>
    p.status === 'active' &&
    (p.repoIds.includes(repoId) || p.packageNames.some((pkg) => packageNames.includes(pkg))));
}

function detectGitRoot(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function detectGitRemote(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function detectPackageNames(rootPath: string): string[] {
  const names: string[] = [];
  const goMod = join(rootPath, 'go.mod');
  if (existsSync(goMod)) {
    const moduleLine = readFileSync(goMod, 'utf-8').split('\n').find((line) => line.startsWith('module '));
    if (moduleLine) names.push(moduleLine.replace(/^module\s+/, '').trim());
  }
  for (const workspacePackage of detectPnpmWorkspacePackageNames(rootPath)) {
    names.push(workspacePackage);
  }
  let dir = rootPath;
  while (true) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string };
        if (parsed.name) names.push(parsed.name);
      } catch {
        // ignore malformed package metadata for identity detection
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dedupe(names);
}

export function bindProjectIdentity(input: BindProjectIdentityInput): string {
  const dir = join(input.memoryDir, 'projects', input.projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const profilePath = join(dir, 'project-profile.md');
  const domains = input.domain ? [input.domain] : [];
  const packageNames = input.packageNames ?? [];
  const markdown = [
    '---',
    `id: project.${input.projectId}.profile`,
    'type: project_profile',
    `project_id: ${input.projectId}`,
    'repo_ids:',
    `  - ${input.repoId}`,
    'domains:',
    ...domains.map((domain) => `  - ${domain}`),
    'package_names:',
    ...packageNames.map((pkg) => `  - "${pkg}"`),
    'status: active',
    '---',
    '',
    `# ${input.projectId}`,
    '',
  ].join('\n');
  writeFileSync(profilePath, markdown, 'utf-8');
  return profilePath;
}

function detectPnpmWorkspacePackageNames(rootPath: string): string[] {
  const workspace = join(rootPath, 'pnpm-workspace.yaml');
  if (!existsSync(workspace)) return [];
  const raw = readFileSync(workspace, 'utf-8');
  const patterns = raw.split('\n')
    .map((line) => line.trim().replace(/^- /, '').replace(/^["']|["']$/g, ''))
    .filter((line) => line.includes('*'));
  const names: string[] = [];
  for (const pattern of patterns) {
    const prefix = pattern.split('*')[0].replace(/\/$/, '');
    const base = join(rootPath, prefix);
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkg = join(base, entry.name, 'package.json');
        if (!existsSync(pkg)) continue;
        const parsed = JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string };
        if (parsed.name) names.push(parsed.name);
      }
    } catch {
      // ignore malformed workspace metadata
    }
  }
  return names;
}

function basenameRepo(rootPath: string): string {
  return rootPath.split('/').filter(Boolean).slice(-1)[0] ?? 'unknown';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
