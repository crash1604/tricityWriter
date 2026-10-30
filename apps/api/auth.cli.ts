// Entry point for `@better-auth/cli generate` only; the server builds its auth in src/index.ts.
import { createDb } from '@tricity/db';
import { createAuth } from './src/auth';

export const auth = createAuth({
  db: createDb(process.env.DATABASE_URL ?? 'postgres://localhost/unused').db,
  secret: 'cli-only-not-a-real-secret-0123456789',
  baseURL: 'http://localhost:3000',
});
