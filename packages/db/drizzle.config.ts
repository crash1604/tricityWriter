import { loadRootEnv } from '@tricity/shared/env';
import { defineConfig } from 'drizzle-kit';

loadRootEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
