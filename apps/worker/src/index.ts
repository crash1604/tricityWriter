import { type CoreDeps, createAiService, publishGeneration, runAutoblog, runGeneration } from '@tricity/core';
import { createDb, system } from '@tricity/db';
import { createJobQueue, createRedis } from '@tricity/jobs';
import { autoblogRunJobSchema, generateJobSchema, JOBS, publishJobSchema, QUEUES, userAgent } from '@tricity/shared';
import { createSiteFetch } from '@tricity/wp-client';
import { type Job, Worker } from 'bullmq';
import { loadConfig } from './config';

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
  userAgent: userAgent(config.WEB_ORIGIN),
  fetch: createSiteFetch({ allowPrivateNetworks: config.ALLOW_PRIVATE_SITE_URLS }),
  // The worker enforces the budget for queued and scheduled articles; the in-progress cap is the API's.
  limits: { platformMonthlyBudgetUsd: config.PLATFORM_MONTHLY_BUDGET_USD },
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

// Articles whose job died with a worker (crash, out-of-memory, a redeploy past BullMQ's stall limit)
// would stay "generating" or "publishing" forever. The grace periods are far longer than any real
// article takes, so BullMQ's own stalled-job retry always gets the first chance.
const PROCESSING_GRACE_MS = 45 * 60_000;
const QUEUED_GRACE_MS = 6 * 60 * 60_000;
async function recoverStaleGenerations(): Promise<void> {
  const now = Date.now();
  const result = await system.recoverStaleGenerations(db, {
    processing: new Date(now - PROCESSING_GRACE_MS),
    queued: new Date(now - QUEUED_GRACE_MS),
  });
  if (result.failed || result.publishingReset) {
    console.warn(
      `[worker] recovered ${result.failed} interrupted article(s) and ${result.publishingReset} interrupted publish(es)`,
    );
  }
}
await recoverStaleGenerations();
const recovery = setInterval(
  () => recoverStaleGenerations().catch((error) => console.error('[worker] recovery failed:', error)),
  10 * 60_000,
);

async function shutdown(): Promise<void> {
  clearInterval(recovery);
  await Promise.all(workers.map((w) => w.close()));
  await jobs.close();
  await connection.quit();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
