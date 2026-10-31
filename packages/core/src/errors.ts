import { AiError } from '@tricity/ai';
import { ConnectorError } from '@tricity/wp-client';

export type AppErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'site_error'
  | 'site_disconnected'
  | 'ai_unavailable'
  | 'ai_error'
  | 'internal';

const STATUS: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  site_error: 502,
  site_disconnected: 409,
  ai_unavailable: 503,
  ai_error: 502,
  internal: 500,
};

// Errors meant for API/MCP callers; the message is safe to show to users.
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found.`);
export const invalid = (message: string) => new AppError('invalid', message);

// Translates errors from lower layers into AppErrors; anything unknown stays as-is (and is a 500).
export function toAppError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof ConnectorError) {
    if (error.status === 401) {
      return new AppError(
        'site_disconnected',
        'The site rejected our connection token. Reconnect it with a new pairing code.',
      );
    }
    return new AppError('site_error', `WordPress: ${error.message}`);
  }
  if (error instanceof AiError) {
    if (error.code === 'no_credential' || error.code === 'unknown_model')
      return new AppError('ai_unavailable', error.message);
    return new AppError('ai_error', error.message);
  }
  return error;
}

export function errorMessage(error: unknown): string {
  const mapped = toAppError(error);
  return mapped instanceof Error ? mapped.message : String(mapped);
}
