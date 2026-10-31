// Applies database migrations, then exits. Run before starting a new version (the "migrate" service in
// deploy/docker-compose.yml).
import { migrateDatabase } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';

loadRootEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
await migrateDatabase(url);
console.log('Database migrations applied.');
