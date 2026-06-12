import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { paths } from '@i-evolve/daemon';
import { detectProjectIdentity, readProjectProfile, type ProjectProfileDocument } from '@i-evolve/storage';

export async function handleIdentityCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  switch (subcommand) {
    case 'detect': {
      const cwd = (flags.cwd as string | undefined) ?? process.cwd();
      const identity = detectProjectIdentity({
        cwd,
        profiles: readProfiles(),
        manualProjectId: flags.project as string | undefined,
        manualDomain: flags.domain as string | undefined,
      });
      console.log(JSON.stringify(identity, null, 2));
      break;
    }
    case 'bind': {
      console.log('Identity bind is recorded through project profiles in MVP6.');
      break;
    }
    default:
      console.error('Usage: i-evolve identity <detect|bind>');
      process.exit(1);
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
          // ignore malformed profiles; validation reports them elsewhere
        }
      }
    }
  };
  scan(projectsDir);
  return profiles;
}
