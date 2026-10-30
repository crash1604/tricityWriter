import {
  getSite,
  listPosts,
  listSites,
  listTerms,
  pairSite,
  refreshSite,
  removeSite,
  toPublicSite,
  updateSite,
} from '@tricity/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { actor, parse } from '../http';

const siteParams = z.object({ siteId: z.string() });

export function siteRoutes(app: FastifyInstance, { deps }: AppDeps): void {
  app.get('/sites', async (request) => ({ sites: await listSites(deps, actor(request)) }));

  app.post('/sites/pair', async (request, reply) => {
    const body = parse(z.object({ url: z.string().min(1), code: z.string().min(4) }), request.body);
    reply.code(201);
    return { site: await pairSite(deps, actor(request), body) };
  });

  app.get('/sites/:siteId', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    return { site: toPublicSite(await getSite(deps, actor(request), siteId)) };
  });

  // Calls the connector and updates the site's status (connected/disconnected/error).
  app.post('/sites/:siteId/check', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    return refreshSite(deps, actor(request), siteId);
  });

  app.patch('/sites/:siteId', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    const patch = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        contentPrompt: z.string().max(4000).optional(),
        designPrompt: z.string().max(4000).optional(),
      }),
      request.body,
    );
    return { site: await updateSite(deps, actor(request), siteId, patch) };
  });

  app.delete('/sites/:siteId', async (request, reply) => {
    const { siteId } = parse(siteParams, request.params);
    await removeSite(deps, actor(request), siteId);
    return reply.code(204).send();
  });

  app.get('/sites/:siteId/posts', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    const query = parse(
      z.object({
        type: z.enum(['post', 'page']).default('post'),
        status: z.enum(['any', 'draft', 'publish', 'future', 'private', 'pending']).default('any'),
        search: z.string().max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
        per_page: z.coerce.number().int().min(1).max(100).default(20),
      }),
      request.query,
    );
    return listPosts(deps, actor(request), siteId, query);
  });

  app.get('/sites/:siteId/terms', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    const { taxonomy } = parse(
      z.object({ taxonomy: z.enum(['category', 'post_tag']).default('category') }),
      request.query,
    );
    return { terms: await listTerms(deps, actor(request), siteId, taxonomy) };
  });
}
