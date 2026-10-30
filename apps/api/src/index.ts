import { createAiService } from '@tricity/core';
import { createDb } from '@tricity/db';
import { createJobQueue, createRedis } from '@tricity/jobs';
import { buildApp } from './app';
import { createAuth } from './auth';
import { loadConfig, USER_AGENT } from './config';

const config = loadConfig();
const { db, close: closeDb } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const jobs = createJobQueue(redis);
const ai = createAiService({
  anthropicKey: config.ANTHROPIC_API_KEY,
  openaiKey: config.OPENAI_API_KEY,
  fake: config.AI_FAKE,
});

const app = buildApp(
  {
    deps: { db, ai, jobs, encryptionKey: config.encryptionKey, userAgent: USER_AGENT },
    auth: createAuth({ db, secret: config.BETTER_AUTH_SECRET, baseURL: config.WEB_ORIGIN }),
  },
  { logger: true },
);
if (config.AI_FAKE) app.log.warn('AI_FAKE=true: every AI call returns placeholder content.');

async function shutdown(): Promise<void> {
  await app.close();
  await jobs.close();
  await redis.quit();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.API_PORT, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
