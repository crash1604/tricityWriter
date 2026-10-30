import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}

export type Db = ReturnType<typeof createDb>['db'];

const MIGRATION_LOCK = 724_113_001;

// Applies pending migrations. Holds an advisory lock on a dedicated connection so concurrent callers
// (parallel test suites, several app instances) apply them once.
export async function migrateDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK})`;
    await migrate(drizzle(sql), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK})`;
  } finally {
    await sql.end();
  }
}
