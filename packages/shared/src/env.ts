// Server-only (uses node:fs), so it is a separate entry point: `@tricity/shared/env`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Loads the repo-root .env for local development. Variables already set in the environment win,
// and production simply has no .env file.
export function loadRootEnv(start: string = process.cwd()): void {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const file = join(dir, '.env');
      if (existsSync(file)) process.loadEnvFile(file);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
