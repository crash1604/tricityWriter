import {
  createGeneration,
  editGeneration,
  type GenerationOutput,
  generationInputSchema,
  getGeneration,
  getGenerationImage,
  listGenerations,
  previewImagePlaceholders,
  regenerate,
  requestPublish,
} from '@tricity/core';
import type { Generation } from '@tricity/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { actor, parse } from '../http';

const idParams = z.object({ id: z.string() });

// The dashboard previews unpublished images through the API; WordPress gets them on publish.
export function presentGeneration(generation: Generation) {
  const output = generation.output as GenerationOutput | null;
  const imageUrl = (slot: number) =>
    `/api/v1/generations/${generation.id}/images/${slot}?v=${generation.updatedAt.getTime()}`;
  return {
    ...generation,
    output: output && {
      ...output,
      previewHtml: previewImagePlaceholders(output.html, imageUrl),
      featuredImageUrl: output.images.some((i) => i.slot === 0) ? imageUrl(0) : null,
    },
  };
}

export function generationRoutes(app: FastifyInstance, { deps }: AppDeps): void {
  app.get('/generations', async (request) => {
    const query = parse(
      z.object({
        siteId: z.string().optional(),
        source: z.enum(['wizard', 'autoblog', 'mcp']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      request.query,
    );
    const rows = await listGenerations(deps, actor(request), query);
    // Lists stay light: no article bodies.
    return {
      generations: rows.map(({ output, ...rest }) => ({
        ...rest,
        title: (output as GenerationOutput | null)?.title ?? null,
      })),
    };
  });

  app.post('/generations', async (request, reply) => {
    const input = parse(generationInputSchema, request.body);
    reply.code(202);
    return { generation: presentGeneration(await createGeneration(deps, actor(request), input, 'wizard')) };
  });

  app.get('/generations/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return { generation: presentGeneration(await getGeneration(deps, actor(request), id)) };
  });

  app.patch('/generations/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    const edit = parse(
      z.object({
        title: z.string().trim().min(1).max(300).optional(),
        html: z.string().max(500_000).optional(),
        metaTitle: z.string().max(200).optional(),
        metaDescription: z.string().max(400).optional(),
        focusKeyword: z.string().max(100).optional(),
        excerpt: z.string().max(1000).optional(),
        categories: z.array(z.string().max(60)).max(5).optional(),
        tags: z.array(z.string().max(60)).max(10).optional(),
      }),
      request.body,
    );
    return { generation: presentGeneration(await editGeneration(deps, actor(request), id, edit)) };
  });

  app.post('/generations/:id/publish', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.object({
        status: z.enum(['draft', 'publish', 'future']),
        scheduledAt: z.iso.datetime({ offset: true }).optional(),
      }),
      request.body,
    );
    reply.code(202);
    return { generation: presentGeneration(await requestPublish(deps, actor(request), id, body)) };
  });

  app.post('/generations/:id/regenerate', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    reply.code(202);
    return { generation: presentGeneration(await regenerate(deps, actor(request), id)) };
  });

  app.get('/generations/:id/images/:slot', async (request, reply) => {
    const { id, slot } = parse(
      z.object({ id: z.string(), slot: z.coerce.number().int().min(0).max(20) }),
      request.params,
    );
    const image = await getGenerationImage(deps, actor(request), id, slot);
    return reply
      .header('content-type', image.mimeType)
      .header('cache-control', 'private, max-age=3600')
      .send(image.data);
  });
}
