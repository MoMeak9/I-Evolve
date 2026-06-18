import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface RepoIdentity {
  repoId: string;
  domain?: string;
  gitRemote?: string;
  packageNames: string[];
  rootPath: string;
  confidence: number;
}

export interface DetectRepoIdentityInput {
  cwd: string;
  gitRemote?: string;
  packageNames?: string[];
  manualDomain?: string;
}

export type ProjectIdentity = RepoIdentity;
export type DetectProjectIdentityInput = DetectRepoIdentityInput;

export function normalizeGitRemoteUrl(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const trimmed = remote.trim();
  const ssh = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return ssh[2].replace(/\.git$/, '');
  const https = trimmed.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (https) return https[1].replace(/\.git$/, '');
  return trimmed.replace(/\.git$/, '');
}

export function detectRepoIdentity(input: DetectRepoIdentityInput): RepoIdentity {
  const rootPath = detectGitRoot(input.cwd) ?? resolve(input.cwd);
  const gitRemote = input.gitRemote ?? detectGitRemote(rootPath);
  const repoId = normalizeGitRemoteUrl(gitRemote) ?? basenameRepo(rootPath);
  const packageNames = dedupe([...(input.packageNames ?? []), ...detectPackageNames(rootPath)]);

  let confidence = 0.45;
  if (gitRemote) confidence += 0.3;
  if (packageNames.length > 0) confidence += 0.1;
  if (input.manualDomain) confidence += 0.05;

  return {
    repoId,
    domain: input.manualDomain ?? inferDomain(repoId, packageNames),
    gitRemote,
    packageNames,
    rootPath,
    confidence: Math.min(1, confidence),
  };
}

/** @deprecated Use detectRepoIdentity; project identity no longer persists memory records. */
export const detectProjectIdentity = detectRepoIdentity;

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

function inferDomain(repoId: string, packageNames: string[]): string | undefined {
  const first = packageNames[0] ?? repoId;
  const parts = first.split(/[\/.-]/).filter(Boolean);
  return parts.length > 1 ? parts[0].replace(/^@/, '') : undefined;
}

function basenameRepo(rootPath: string): string {
  return rootPath.split('/').filter(Boolean).slice(-1)[0] ?? 'unknown';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
