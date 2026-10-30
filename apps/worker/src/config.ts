import { parseEncryptionKey } from '@tricity/core';
import { loadRootEnv } from '@tricity/shared/env';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (openssl rand -base64 32)'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_FAKE: z.stringbool().default(false),
  GENERATION_CONCURRENCY: z.coerce.number().int().min(1).default(4),
});

export type Config = z.infer<typeof envSchema> & { encryptionKey: Buffer };

export function loadConfig(): Config {
  loadRootEnv();
  const env = envSchema.parse(process.env);
  return { ...env, encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY) };
}

export const USER_AGENT = 'TriCityWriter/0.1 (+https://github.com/tricity-writer)';
