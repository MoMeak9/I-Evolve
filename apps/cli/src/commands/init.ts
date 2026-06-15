import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { paths } from '@i-evolve/daemon';
import {
  bindProjectIdentity,
  detectProjectIdentity,
  readProjectProfile,
  type ProjectProfileDocument,
} from '@i-evolve/storage';
import { GitMemorySync } from '@i-evolve/git-sync';
import { ensureDaemon } from './ensure-daemon.js';

interface InitFlags {
  yes?: boolean;
  'non-interactive'?: boolean;
  project?: string;
  domain?: string;
  remote?: string;
  'skip-remote'?: boolean;
  cwd?: string;
}

/**
 * Interactive onboarding for the current repository:
 *   1. Auto-start the daemon.
 *   2. Detect project identity and bind it (after confirmation).
 *   3. Ask which remote git repo to use as shared memory (after confirmation).
 *   4. Run a health check.
 *
 * Non-interactive (hooks / scripts): pass --non-interactive to do detection +
 * daemon start only, or --yes / explicit flags to bind and wire remote without prompts.
 */
export async function handleInitCommand(flags: InitFlags): Promise<void> {
  const cwd = flags.cwd ?? process.cwd();
  const interactive = !flags['non-interactive'] && !flags.yes && process.stdin.isTTY;

  console.log('I-Evolve init\n');

  // 1. Daemon
  const daemonState = await ensureDaemon();
  console.log(
    daemonState.running
      ? `  daemon: running${daemonState.started ? ' (started)' : ''}`
      : '  daemon: could not start (continuing; memory features may be unavailable)',
  );

  // 2. Identity
  const detected = detectProjectIdentity({
    cwd,
    profiles: readProfiles(),
    manualProjectId: flags.project,
    manualDomain: flags.domain,
  });
  console.log(`  repo: ${detected.repoId}`);
  if (detected.gitRemote) console.log(`  git remote: ${detected.gitRemote}`);
  console.log(`  detection confidence: ${detected.confidence.toFixed(2)}`);

  if (flags['non-interactive']) {
    console.log('\nNon-interactive: skipped binding and remote setup.');
    return;
  }

  const suggestedProject = detected.projectId ?? basename(detected.repoId);
  let projectId = flags.project ?? suggestedProject;
  let domain = flags.domain ?? detected.domain;

  if (interactive) {
    const { input, confirm } = await import('@inquirer/prompts');
    const doBind = await confirm({
      message: `Bind this repo to a project identity?`,
      default: true,
    });
    if (doBind) {
      projectId = await input({ message: 'Project id:', default: projectId });
      domain = (await input({ message: 'Domain (optional):', default: domain ?? '' })) || undefined;
      bindAndReport(projectId, detected, domain);
    } else {
      console.log('  identity: skipped');
    }
  } else {
    // --yes or piped: accept detected/flag values.
    bindAndReport(projectId, detected, domain);
  }

  // 3. Remote memory repo
  await setupRemote(flags, detected, cwd, interactive);

  // 4. Health
  console.log('');
  runDoctor();
}

function bindAndReport(
  projectId: string,
  detected: ReturnType<typeof detectProjectIdentity>,
  domain: string | undefined,
): void {
  const profilePath = bindProjectIdentity({
    memoryDir: paths.shared.memory,
    projectId,
    repoId: detected.repoId,
    domain,
    packageNames: detected.packageNames,
  });
  console.log(`  identity bound: project=${projectId}${domain ? `, domain=${domain}` : ''}`);
  console.log(`  profile: ${profilePath}`);
}

async function setupRemote(
  flags: InitFlags,
  detected: ReturnType<typeof detectProjectIdentity>,
  cwd: string,
  interactive: boolean,
): Promise<void> {
  const sync = new GitMemorySync(paths.shared.memory);
  if (sync.isInitialized()) {
    console.log('  remote memory: already initialized');
    return;
  }
  if (flags['skip-remote']) {
    console.log('  remote memory: skipped (local-only)');
    return;
  }

  // Explicit URL wins, no prompt.
  if (flags.remote) {
    initRemote(flags.remote);
    return;
  }

  if (!interactive) {
    console.log('  remote memory: not initialized (local-only; pass --remote <url> to wire one)');
    return;
  }

  const { select, input, confirm } = await import('@inquirer/prompts');
  const candidates = listGitRemotes(cwd);
  const choices = [
    ...candidates.map((c) => ({ name: `${c.name} → ${c.url}`, value: c.url })),
    { name: 'Enter a different git URL', value: '__custom__' },
    { name: 'Skip (local-only memory)', value: '__skip__' },
  ];

  const picked = await select({
    message: 'Which remote git repo should store shared memory?',
    choices,
  });

  let url: string | undefined;
  if (picked === '__skip__') {
    console.log('  remote memory: skipped (local-only)');
    return;
  } else if (picked === '__custom__') {
    url = (await input({ message: 'Git URL:' })).trim();
    if (!url) {
      console.log('  remote memory: skipped (no URL provided)');
      return;
    }
  } else {
    url = picked;
  }

  const ok = await confirm({
    message: `Use ${url} as shared memory? Existing local memory is merged in (remote wins on conflicts; local copies are backed up).`,
    default: true,
  });
  if (!ok) {
    console.log('  remote memory: skipped');
    return;
  }
  initRemote(url);
}

function initRemote(url: string): void {
  if (existsSync(join(paths.shared.memory, '.git'))) {
    console.log('  remote memory: already initialized');
    return;
  }
  try {
    const result = new GitMemorySync(paths.shared.memory).attach(url);
    console.log(`  remote memory: ${result.message}`);
    if (result.collisions.length) {
      console.log(
        `    kept remote version for ${result.collisions.length} colliding file(s); local copies preserved in the backup dir.`,
      );
    }
    if (result.restored.length) {
      console.log(
        `    ${result.restored.length} local-only file(s) restored on top (uncommitted; review and commit when ready).`,
      );
    }
  } catch (err) {
    console.error(
      `  remote memory: attach failed (${err instanceof Error ? err.message : String(err)}). Local memory left unchanged.`,
    );
  }
}

export interface GitRemote {
  name: string;
  url: string;
}

/** Parse `git remote -v` output into unique fetch remotes. Exported for testing. */
export function parseGitRemotes(output: string): GitRemote[] {
  const seen = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
    if (match) seen.set(match[1], match[2]);
  }
  return Array.from(seen, ([name, url]) => ({ name, url }));
}

function listGitRemotes(cwd: string): GitRemote[] {
  try {
    const out = execFileSync('git', ['remote', '-v'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitRemotes(out);
  } catch {
    return [];
  }
}

function runDoctor(): void {
  try {
    const entry = new URL('../index.js', import.meta.url).pathname;
    execFileSync(process.execPath, ['--import', 'tsx', entry, 'doctor', '--bootstrap'], {
      stdio: 'inherit',
    });
  } catch {
    // doctor prints its own diagnostics; ignore non-zero exit here.
  }
}

function readProfiles(): ProjectProfileDocument[] {
  const projectsDir = join(paths.shared.memory, 'projects');
  if (!existsSync(projectsDir)) return [];
  const profiles: ProjectProfileDocument[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      if (entry.isFile() && entry.name === 'project-profile.md') {
        try {
          profiles.push(readProjectProfile(readFileSync(full, 'utf-8')));
        } catch {
          // ignore malformed profiles
        }
      }
    }
  };
  scan(projectsDir);
  return profiles;
}

function basename(repoId: string): string {
  return repoId.split('/').filter(Boolean).slice(-1)[0] ?? repoId;
}
