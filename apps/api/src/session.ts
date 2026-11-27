import { AppError, memberRole } from '@tricity/core';
import type { Db } from '@tricity/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Auth, createPersonalWorkspace } from './auth';
import { sendResponse, toFetchRequest } from './http';

// Better Auth endpoints we don't expose. list-user-invitations hands invitation ids to whoever signs up
// with the invitee's email address, which without verified email proves nothing; invitees use the link.
const HIDDEN_AUTH_ROUTES = new Set(['/api/auth/organization/list-user-invitations']);

// Bridges Fastify to Better Auth's fetch handler at /api/auth/*.
export function registerAuthRoutes(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      if (HIDDEN_AUTH_ROUTES.has(request.url.split('?')[0] ?? '')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      return sendResponse(reply, await auth.handler(toFetchRequest(request)));
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
    let role = orgId ? await memberRole(db, orgId, session.user.id) : null;
    if (!orgId || !role) {
      // No active workspace yet (the sign-up session is created before the workspace exists), or it is
      // gone (deleted, or the user was removed): continue in another workspace, or a new personal one.
      let membership = await db.query.member.findFirst({
        where: (m, { eq }) => eq(m.userId, session.user.id),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });
      if (!membership) {
        await createPersonalWorkspace(auth, session.user, true);
        membership = await db.query.member.findFirst({ where: (m, { eq }) => eq(m.userId, session.user.id) });
        if (!membership) throw new AppError('internal', 'Could not create a workspace for your account.');
      }
      await auth.api.setActiveOrganization({ headers, body: { organizationId: membership.organizationId } });
      orgId = membership.organizationId;
      role = membership.role as typeof role;
    }
    if (!role) throw new AppError('forbidden', 'You are no longer a member of this workspace.');
    request.actor = { orgId, userId: session.user.id, role };
  };
}
