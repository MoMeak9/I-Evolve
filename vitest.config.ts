import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@i-evolve/core': join(root, 'packages/core/src/index.ts'),
      '@i-evolve/shared': join(root, 'packages/shared/src/index.ts'),
      '@i-evolve/schema': join(root, 'packages/schema/src/index.ts'),
      '@i-evolve/storage': join(root, 'packages/storage/src/index.ts'),
      '@i-evolve/daemon': join(root, 'packages/daemon/src/index.ts'),
      '@i-evolve/git-sync': join(root, 'packages/git-sync/src/index.ts'),
      '@i-evolve/ai-evolution': join(root, 'packages/ai-evolution/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
