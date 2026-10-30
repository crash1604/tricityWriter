import { parseEncryptionKey } from '@tricity/core';
import { loadRootEnv } from '@tricity/shared/env';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (openssl rand -base64 32)'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_FAKE: z.stringbool().default(false),
});

export type Config = z.infer<typeof envSchema> & { encryptionKey: Buffer };

export function loadConfig(): Config {
  loadRootEnv();
  const env = envSchema.parse(process.env);
  return { ...env, encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY) };
}

export const USER_AGENT = 'TriCityWriter/0.1 (+https://github.com/tricity-writer)';
