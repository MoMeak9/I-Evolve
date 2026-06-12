import { paths } from '@i-evolve/daemon';
import { getMigrationStatus, runMigrations, type MigrationStep } from '@i-evolve/git-sync';

// MVP5: migration registry is empty by default. Steps are added as schema evolves.
const MIGRATION_STEPS: MigrationStep[] = [];

export async function handleMigrateCommand(subcommand: string | undefined, flags: Record<string, unknown>): Promise<void> {
  const repoDir = paths.shared.memory;

  switch (subcommand) {
    case 'status': {
      const status = getMigrationStatus(repoDir, MIGRATION_STEPS);
      console.log(`Current schema version: ${status.currentVersion}`);
      console.log(`Pending migrations: ${status.pending.length}`);
      for (const step of status.pending) {
        console.log(`  ${step.id}: ${step.description}`);
      }
      break;
    }
    case 'run': {
      const to = flags.to ? parseInt(flags.to as string, 10) : undefined;
      const dryRun = Boolean(flags['dry-run']);
      const result = runMigrations(repoDir, MIGRATION_STEPS, { to, dryRun });
      if (result.applied.length === 0) {
        console.log('No migrations to apply.');
      } else {
        console.log(`${dryRun ? '[dry-run] ' : ''}Migrated ${result.fromVersion} → ${result.toVersion}`);
        console.log(`Applied: ${result.applied.join(', ')}`);
        console.log(`Changed files: ${result.changedFiles.length}`);
      }
      break;
    }
    default:
      console.error('Usage: i-evolve migrate <status|run> [--to <n>] [--dry-run]');
      process.exit(1);
  }
}
