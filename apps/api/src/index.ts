import { createAiService } from '@tricity/core';
import { createDb } from '@tricity/db';
import { createJobQueue, createRedis } from '@tricity/jobs';
import pino from 'pino';
import { buildApp } from './app';
import { createAuth, oauthEnabled } from './auth';
import { loadConfig, USER_AGENT } from './config';
import { logMailer, resendMailer } from './mailer';

const config = loadConfig();
const log = pino();
const { db, close: closeDb } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const jobs = createJobQueue(redis);
const ai = createAiService({
  anthropicKey: config.ANTHROPIC_API_KEY,
  openaiKey: config.OPENAI_API_KEY,
  fake: config.AI_FAKE,
  allowPlatformKeys: config.ALLOW_PLATFORM_KEYS,
});
const mailer =
  config.EMAIL_PROVIDER === 'resend' && config.RESEND_API_KEY
    ? resendMailer(config.RESEND_API_KEY, config.EMAIL_FROM)
    : logMailer(log);

const app = buildApp(
  {
    deps: { db, ai, jobs, encryptionKey: config.encryptionKey, userAgent: USER_AGENT },
    auth: createAuth({ db, secret: config.BETTER_AUTH_SECRET, baseURL: config.WEB_ORIGIN, mailer }),
    mailer,
    origin: config.WEB_ORIGIN,
  },
  { logger: true },
);
if (config.AI_FAKE) app.log.warn('AI_FAKE=true: every AI call returns placeholder content.');
if (!mailer.delivers) app.log.warn('EMAIL_PROVIDER=none: password reset links and invitations are only logged.');
if (!oauthEnabled(config.WEB_ORIGIN)) {
  app.log.warn('MCP sign-in (OAuth) is off: WEB_ORIGIN must be https. MCP keys still work.');
}

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
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
