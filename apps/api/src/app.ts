import type { CoreDeps } from '@tricity/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Auth, mcpResource, oauthEnabled } from './auth';
import { registerErrorHandler } from './http';
import type { Mailer } from './mailer';
import { registerMcp } from './mcp';
import { createOAuthVerifier, registerOAuthDiscovery } from './oauth';
import { generationRoutes } from './routes/generations';
import { siteRoutes } from './routes/sites';
import { workspaceRoutes } from './routes/workspace';
import { registerAuthRoutes, requireSession } from './session';

export const VERSION = '0.2.0';

export interface AppDeps {
  deps: CoreDeps;
  auth: Auth;
  mailer: Mailer;
  // Public origin of the dashboard (same as Better Auth's baseURL).
  origin: string;
}

// Builds the app without listening, so tests can use app.inject().
export function buildApp(appDeps: AppDeps, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  registerErrorHandler(app);
  // The OAuth token endpoint takes form-encoded bodies; keep them raw for Better Auth.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body),
  );

  app.get('/health', async () => ({ ok: true, version: VERSION }));
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
