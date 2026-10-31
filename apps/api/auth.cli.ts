// Entry point for the Better Auth CLI only (`pnpm dlx auth@<version> generate`); the server builds its
// auth in src/index.ts. Uses a loopback origin so the OAuth/MCP plugins (and their tables) are included.
import { createDb } from '@tricity/db';
import { createAuth } from './src/auth';
import { logMailer } from './src/mailer';

export const auth = createAuth({
  db: createDb(process.env.DATABASE_URL ?? 'postgres://localhost/unused').db,
  secret: 'cli-only-not-a-real-secret-0123456789',
  baseURL: 'http://localhost:3000',
  mailer: logMailer(console),
});
