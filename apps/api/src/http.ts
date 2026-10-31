import { type Actor, AppError, invalid } from '@tricity/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw invalid(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}

export function actor(request: FastifyRequest): Actor {
  return request.actor;
}

// Fastify → fetch Request, for handlers written against web standards (Better Auth, MCP SDK).
export function toFetchRequest(request: FastifyRequest, url?: string): Request {
  const target = url ?? new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).toString();
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined;
  return new Request(target, {
    method: request.method,
    headers: fromNodeHeaders(request.headers),
    body: hasBody ? (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)) : undefined,
  });
}

// fetch Response → Fastify reply. Set-Cookie headers are kept separate.
export async function sendResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header('set-cookie', cookies);
  return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
}

// AppErrors carry user-safe messages and their HTTP status; anything else is a logged 500.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'invalid', message: error.message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'invalid', message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong.' } });
  });
}
