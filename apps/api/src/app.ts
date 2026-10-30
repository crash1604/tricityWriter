import type { CoreDeps } from '@tricity/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Auth } from './auth';
import { registerErrorHandler } from './http';
import { registerMcp } from './mcp';
import { generationRoutes } from './routes/generations';
import { siteRoutes } from './routes/sites';
import { workspaceRoutes } from './routes/workspace';
import { registerAuthRoutes, requireSession } from './session';

export const VERSION = '0.1.0';

export interface AppDeps {
  deps: CoreDeps;
  auth: Auth;
}

// Builds the app without listening, so tests can use app.inject().
export function buildApp(appDeps: AppDeps, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true, version: VERSION }));
  registerAuthRoutes(app, appDeps.auth);
  registerMcp(app, appDeps.deps, VERSION);

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
