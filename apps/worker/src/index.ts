import { type CoreDeps, createAiService, publishGeneration, runAutoblog, runGeneration } from '@tricity/core';
import { createDb, system } from '@tricity/db';
import { createJobQueue, createRedis } from '@tricity/jobs';
import { autoblogRunJobSchema, generateJobSchema, JOBS, publishJobSchema, QUEUES } from '@tricity/shared';
import { type Job, Worker } from 'bullmq';
import { loadConfig, USER_AGENT } from './config';

const config = loadConfig();
const { db, close: closeDb } = createDb(config.DATABASE_URL);
const connection = createRedis(config.REDIS_URL);
const jobs = createJobQueue(connection);
const deps: CoreDeps = {
  db,
  ai: createAiService({
    anthropicKey: config.ANTHROPIC_API_KEY,
    openaiKey: config.OPENAI_API_KEY,
    fake: config.AI_FAKE,
    allowPlatformKeys: config.ALLOW_PLATFORM_KEYS,
  }),
  jobs,
  encryptionKey: config.encryptionKey,
  userAgent: USER_AGENT,
};

async function processGeneration(job: Job): Promise<void> {
  if (job.name === JOBS.generate) {
    // Retryable AI errors are re-thrown (and retried by BullMQ) until the last attempt.
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runGeneration(deps, generateJobSchema.parse(job.data), !lastAttempt);
  } else if (job.name === JOBS.publish) {
    await publishGeneration(deps, publishJobSchema.parse(job.data));
  } else {
    throw new Error(`Unknown job ${job.name}`);
  }
}

async function processAutoblog(job: Job): Promise<unknown> {
  return runAutoblog(deps, autoblogRunJobSchema.parse(job.data));
}

const workers = [
  new Worker(QUEUES.generation, processGeneration, { connection, concurrency: config.GENERATION_CONCURRENCY }),
  new Worker(QUEUES.autoblog, processAutoblog, { connection, concurrency: 2 }),
];
for (const worker of workers) {
  worker.on('ready', () => console.log(`[worker] listening on "${worker.name}"`));
  worker.on('error', (error) => console.error(`[worker] ${worker.name}:`, error.message));
  worker.on('failed', (job, error) =>
    console.error(`[worker] ${worker.name} ${job?.name} ${job?.id} failed:`, error.message),
  );
  worker.on('completed', (job, result) =>
    console.log(`[worker] ${worker.name} ${job.name} ${job.id} done${result ? ` ${JSON.stringify(result)}` : ''}`),
  );
}

// Schedules live in Redis; the database is the source of truth. Re-register them on startup so a
// flushed Redis or a missed update heals itself.
const profiles = await system.listEnabledAutoblogProfiles(db);
for (const profile of profiles) {
  await jobs.scheduleAutoblog({ ...profile, enabled: true });
}
console.log(
  `[worker] ${profiles.length} auto-blogging schedule(s) registered${config.AI_FAKE ? ' (AI_FAKE=true)' : ''}`,
);

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  await jobs.close();
  await connection.quit();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
