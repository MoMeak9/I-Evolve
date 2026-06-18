import { detectRepoIdentity } from '@i-evolve/storage';

export async function handleIdentityCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  switch (subcommand) {
    case 'detect': {
      const cwd = (flags.cwd as string | undefined) ?? process.cwd();
      const identity = detectRepoIdentity({
        cwd,
        manualDomain: flags.domain as string | undefined,
      });
      console.log(JSON.stringify(identity, null, 2));
      break;
    }
    default:
      console.error('Usage: i-evolve identity detect [--domain <domain>]');
      process.exit(1);
  }
}
