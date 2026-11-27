import type { CoreDeps } from '@tricity/core';
import { VERSION } from '@tricity/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Auth, mcpResource, oauthEnabled, type SignupMode } from './auth';
import { registerErrorHandler } from './http';
import type { Mailer } from './mailer';
import { registerMcp } from './mcp';
import { createOAuthVerifier, registerOAuthDiscovery } from './oauth';
import { generationRoutes } from './routes/generations';
import { siteRoutes } from './routes/sites';
import { workspaceRoutes } from './routes/workspace';
import { registerAuthRoutes, requireSession } from './session';

export { VERSION } from '@tricity/shared';

export interface AppDeps {
  deps: CoreDeps;
  auth: Auth;
  mailer: Mailer;
  // Public origin of the dashboard (same as Better Auth's baseURL).
  origin: string;
  // How accounts are created; shown on the sign-up page. Defaults to open, no verification.
  signup?: { mode: SignupMode; emailVerification: boolean };
}

// Builds the app without listening, so tests can use app.inject().
export function buildApp(appDeps: AppDeps, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  registerErrorHandler(app);
  // The OAuth token endpoint takes form-encoded bodies; keep them raw for Better Auth.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body),
  );

  // Liveness for Docker and uptime monitors: the API is up and can reach its database.
  app.get('/health', async (_request, reply) => {
    try {
      await appDeps.deps.db.execute(sql`select 1`);
      return { ok: true, version: VERSION };
    } catch {
      return reply.code(503).send({ ok: false, version: VERSION });
    }
  });
  // What the sign-in and sign-up pages need to know before anyone is signed in.
  app.get('/api/public/config', async () => ({
    signupMode: appDeps.signup?.mode ?? 'open',
    emailVerification: appDeps.signup?.emailVerification ?? false,
    passwordResetByEmail: appDeps.mailer.delivers,
  }));
  registerAuthRoutes(app, appDeps.auth);

  if (oauthEnabled(appDeps.origin)) {
    const oauth = { origin: appDeps.origin, resource: mcpResource(appDeps.origin) };
    registerOAuthDiscovery(app, appDeps.auth, oauth);
    registerMcp(app, appDeps.deps, VERSION, {
      verifyOAuthToken: createOAuthVerifier(appDeps.auth, appDeps.deps, oauth),
      resourceMetadataUrl: `${appDeps.origin}/.well-known/oauth-protected-resource/mcp`,
    });
  } else {
    registerMcp(app, appDeps.deps, VERSION);
  }

  app.register(
    async (v1) => {
      v1.addHook('preHandler', requireSession(appDeps.auth, appDeps.deps.db));
      siteRoutes(v1, appDeps);
      generationRoutes(v1, appDeps);
      workspaceRoutes(v1, appDeps);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
