import { type CoreDeps, createAiService, deleteWorkspaceData, forgetUser } from '@tricity/core';
import { createDb } from '@tricity/db';
import { createJobQueue, createRedis } from '@tricity/jobs';
import { userAgent } from '@tricity/shared';
import { createSiteFetch } from '@tricity/wp-client';
import pino from 'pino';
import { buildApp } from './app';
import { createAuth, oauthEnabled } from './auth';
import { loadConfig } from './config';
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

const deps: CoreDeps = {
  db,
  ai,
  jobs,
  encryptionKey: config.encryptionKey,
  userAgent: userAgent(config.WEB_ORIGIN),
  platformUrl: config.WEB_ORIGIN,
  fetch: createSiteFetch({ allowPrivateNetworks: config.ALLOW_PRIVATE_SITE_URLS }),
  limits: {
    platformMonthlyBudgetUsd: config.PLATFORM_MONTHLY_BUDGET_USD,
    maxActiveGenerations: config.MAX_ACTIVE_GENERATIONS,
  },
};

const app = buildApp(
  {
    deps,
    auth: createAuth({
      db,
      secret: config.BETTER_AUTH_SECRET,
      baseURL: config.WEB_ORIGIN,
      mailer,
      signupMode: config.SIGNUP_MODE,
      requireEmailVerification: config.REQUIRE_EMAIL_VERIFICATION,
      onDeleteWorkspace: (orgId) => deleteWorkspaceData(deps, orgId),
      onDeleteUser: (userId) => forgetUser(deps, userId),
    }),
    mailer,
    origin: config.WEB_ORIGIN,
    signup: { mode: config.SIGNUP_MODE, emailVerification: config.REQUIRE_EMAIL_VERIFICATION && mailer.delivers },
  },
  { logger: true },
);
if (config.AI_FAKE) app.log.warn('AI_FAKE=true: every AI call returns placeholder content.');
if (config.ALLOW_PRIVATE_SITE_URLS)
  app.log.warn('ALLOW_PRIVATE_SITE_URLS=true: sites may resolve to private addresses.');
if (config.SIGNUP_MODE === 'invite')
  app.log.info('SIGNUP_MODE=invite: only the first account and invited people can sign up.');
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
