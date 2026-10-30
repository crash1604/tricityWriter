import { AppError } from '@tricity/core';
import type { Db } from '@tricity/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth';

// Bridges Fastify to Better Auth's fetch handler at /api/auth/*.
export function registerAuthRoutes(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: request.method === 'GET' || request.body === undefined ? undefined : JSON.stringify(request.body),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

// preHandler for /api/v1: requires a session with an active organization and sets request.actor.
export function requireSession(auth: Auth, db: Db) {
  return async (request: FastifyRequest) => {
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers });
    if (!session) throw new AppError('unauthorized', 'Sign in to continue.');

    let orgId = session.session.activeOrganizationId;
    if (!orgId) {
      // The sign-up session is created before the user's workspace exists, so it has no active
      // organization yet. Activate the user's first workspace.
      const membership = await db.query.member.findFirst({
        where: (m, { eq }) => eq(m.userId, session.user.id),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });
      if (!membership) throw new AppError('conflict', 'Your account has no workspace.');
      await auth.api.setActiveOrganization({ headers, body: { organizationId: membership.organizationId } });
      orgId = membership.organizationId;
    }
    request.actor = { orgId, userId: session.user.id };
  };
}
