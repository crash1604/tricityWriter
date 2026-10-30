import {
  addAutoblogTopics,
  autoblogProfileSchema,
  createMcpKey,
  createTemplate,
  deleteTemplate,
  getAutoblog,
  listMcpKeys,
  listTemplates,
  removeAutoblogTopic,
  revokeMcpKey,
  saveAutoblog,
  triggerAutoblogRun,
  updateTemplate,
  usageSummary,
} from '@tricity/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { actor, parse } from '../http';

const kindSchema = z.enum(['content', 'design']);

export function workspaceRoutes(app: FastifyInstance, { deps, auth }: AppDeps): void {
  app.get('/me', async (request) => {
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers });
    const organizations = await auth.api.listOrganizations({ headers });
    return {
      user: session && { id: session.user.id, name: session.user.name, email: session.user.email },
      organizationId: actor(request).orgId,
      organizations: organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    };
  });

  app.get('/models', async () => ({
    models: deps.ai.models(),
    defaults: { text: deps.ai.defaultModel('text')?.id ?? null, image: deps.ai.defaultModel('image')?.id ?? null },
    fake: deps.ai.isFake,
  }));

  app.get('/usage', async (request) => usageSummary(deps, actor(request)));

  // Templates
  app.get('/templates', async (request) => {
    const { kind } = parse(z.object({ kind: kindSchema.optional() }), request.query);
    return { templates: await listTemplates(deps, actor(request), kind) };
  });
  app.post('/templates', async (request, reply) => {
    const body = parse(
      z.object({ kind: kindSchema, name: z.string(), description: z.string().optional(), prompt: z.string() }),
      request.body,
    );
    reply.code(201);
    return { template: await createTemplate(deps, actor(request), body) };
  });
  app.patch('/templates/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const body = parse(
      z.object({ name: z.string().optional(), description: z.string().optional(), prompt: z.string().optional() }),
      request.body,
    );
    return { template: await updateTemplate(deps, actor(request), id, body) };
  });
  app.delete('/templates/:id', async (request, reply) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    await deleteTemplate(deps, actor(request), id);
    return reply.code(204).send();
  });

  // Auto-blogging
  const siteParams = z.object({ siteId: z.string() });
  app.get('/sites/:siteId/autoblog', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    return getAutoblog(deps, actor(request), siteId);
  });
  app.put('/sites/:siteId/autoblog', async (request) => {
    const { siteId } = parse(siteParams, request.params);
    return saveAutoblog(deps, actor(request), siteId, parse(autoblogProfileSchema, request.body));
  });
  app.post('/sites/:siteId/autoblog/topics', async (request, reply) => {
    const { siteId } = parse(siteParams, request.params);
    const { topics } = parse(
      z.object({
        topics: z
          .array(z.union([z.string(), z.object({ topic: z.string(), keywords: z.string().optional() })]))
          .min(1)
          .max(200),
      }),
      request.body,
    );
    reply.code(201);
    const added = await addAutoblogTopics(
      deps,
      actor(request),
      siteId,
      topics.map((t) => (typeof t === 'string' ? { topic: t } : t)),
    );
    return { topics: added };
  });
  app.delete('/autoblog/topics/:topicId', async (request, reply) => {
    const { topicId } = parse(z.object({ topicId: z.string() }), request.params);
    await removeAutoblogTopic(deps, actor(request), topicId);
    return reply.code(204).send();
  });
  app.post('/sites/:siteId/autoblog/run', async (request, reply) => {
    const { siteId } = parse(siteParams, request.params);
    await triggerAutoblogRun(deps, actor(request), siteId);
    return reply.code(202).send({ ok: true });
  });

  // MCP keys
  app.get('/mcp-keys', async (request) => ({ keys: await listMcpKeys(deps, actor(request)) }));
  app.post('/mcp-keys', async (request, reply) => {
    const { name } = parse(z.object({ name: z.string() }), request.body);
    reply.code(201);
    return createMcpKey(deps, actor(request), name);
  });
  app.delete('/mcp-keys/:id', async (request, reply) => {
    const { id } = parse(z.object({ id: z.string() }), request.params);
    await revokeMcpKey(deps, actor(request), id);
    return reply.code(204).send();
  });
}
