import { parseEncryptionKey } from '@tricity/core';
import { loadRootEnv } from '@tricity/shared/env';
import { z } from 'zod';

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
    API_PORT: z.coerce.number().int().default(4000),
    // Interface to listen on: 127.0.0.1 locally, 0.0.0.0 inside a container.
    API_HOST: z.string().default('127.0.0.1'),
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (openssl rand -base64 32)'),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // false = every workspace must add its own AI keys (Settings → AI keys).
    ALLOW_PLATFORM_KEYS: z.stringbool().default(true),
    AI_FAKE: z.stringbool().default(false),
    // none = emails (password reset links, invitations) are written to the server log.
    EMAIL_PROVIDER: z.enum(['none', 'resend']).default('none'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('TriCity Writer <no-reply@example.com>'),
  })
  .refine((env) => env.EMAIL_PROVIDER !== 'resend' || env.RESEND_API_KEY, {
    message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
  });

export type Config = z.infer<typeof envSchema> & { encryptionKey: Buffer };

export function loadConfig(): Config {
  loadRootEnv();
  const env = envSchema.parse(process.env);
  return {
    ...env,
    WEB_ORIGIN: env.WEB_ORIGIN.replace(/\/+$/, ''),
    encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY),
  };
}

export const USER_AGENT = 'TriCityWriter/0.2 (+https://github.com/tricity-writer)';
