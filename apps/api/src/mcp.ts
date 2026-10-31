import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  type Actor,
  AppError,
  addAutoblogTopics,
  type CoreDeps,
  createGeneration,
  createPost,
  type GenerationOutput,
  generateFeaturedImage,
  getAutoblog,
  getGeneration,
  getPost,
  listPosts,
  listSites,
  listTemplates,
  listTerms,
  refreshSite,
  requestPublish,
  sanitizeArticleHtml,
  setPostSeo,
  toAppError,
  trashPost,
  triggerAutoblogRun,
  updatePost,
  verifyMcpKey,
} from '@tricity/core';
import type { UpsertPost } from '@tricity/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendResponse, toFetchRequest } from './http';

// MCP tools call the same core services as the REST routes, so tenant scoping and the connector's
// permissions are identical. HTML supplied by an assistant is sanitized like generated HTML.

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
  } catch (error) {
    const mapped = toAppError(error);
    if (mapped instanceof AppError) return { isError: true, content: [{ type: 'text', text: mapped.message }] };
    throw error;
  }
}

const siteId = z.string().describe('Site id from list_sites.');
const postId = z.number().int().describe('WordPress post or page id.');
const status = z.enum(['draft', 'publish', 'future', 'private']);
const scheduledAt = z.string().describe('ISO 8601 date-time; required when status is "future".');

function postFields(args: {
  title?: string;
  content_html?: string;
  excerpt?: string;
  status?: z.infer<typeof status>;
  scheduled_at?: string;
  categories?: string[];
  tags?: string[];
}): UpsertPost {
  return {
    ...(args.title !== undefined && { title: args.title }),
    ...(args.content_html !== undefined && { content: sanitizeArticleHtml(args.content_html) }),
    ...(args.excerpt !== undefined && { excerpt: args.excerpt }),
    ...(args.status !== undefined && { status: args.status }),
    ...(args.scheduled_at !== undefined && { date_gmt: args.scheduled_at }),
    ...(args.categories !== undefined && { categories: args.categories }),
    ...(args.tags !== undefined && { tags: args.tags }),
  };
}

export function createMcpServer(deps: CoreDeps, actor: Actor, version: string): McpServer {
  const server = new McpServer(
    { name: 'tricity-writer', version },
    {
      instructions:
        'Manage WordPress sites connected to TriCity Writer. Call check_readiness first. To publish your own writing, use create_post (no AI credits). To have TriCity Writer write an article with its templates, images and SEO, use generate_article, then poll get_article.',
    },
  );

  server.registerTool(
    'check_readiness',
    { description: 'Connected sites and available AI models. Call this first.', annotations: { readOnlyHint: true } },
    () =>
      run(async () => ({
        sites: (await listSites(deps, actor)).map((s) => ({ id: s.id, name: s.name, url: s.url, status: s.status })),
        defaultTextModel: deps.ai.defaultModel('text')?.id ?? null,
        defaultImageModel: deps.ai.defaultModel('image')?.id ?? null,
        ...(deps.ai.isFake && { note: 'AI is in fake mode: generated content is placeholder text.' }),
      })),
  );

  server.registerTool(
    'list_sites',
    { description: 'List connected WordPress sites.', annotations: { readOnlyHint: true } },
    () =>
      run(async () =>
        (await listSites(deps, actor)).map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          status: s.status,
          seoPlugin: s.seoPlugin,
        })),
      ),
  );

  server.registerTool(
    'get_site_status',
    {
      description: 'Check the connection to a site and what the connected WordPress user may do.',
      inputSchema: { site_id: siteId },
    },
    ({ site_id }) => run(() => refreshSite(deps, actor, site_id)),
  );

  server.registerTool(
    'list_posts',
    {
      description: 'List posts or pages, newest first.',
      inputSchema: {
        site_id: siteId,
        type: z.enum(['post', 'page']).default('post'),
        status: z.enum(['any', 'draft', 'publish', 'future', 'private', 'pending']).default('any'),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true },
    },
    ({ site_id, ...query }) => run(() => listPosts(deps, actor, site_id, { ...query, per_page: 20 })),
  );

  server.registerTool(
    'get_post',
    {
      description: 'Read a post or page including its HTML, taxonomies and SEO fields.',
      inputSchema: { site_id: siteId, post_id: postId },
      annotations: { readOnlyHint: true },
    },
    ({ site_id, post_id }) => run(() => getPost(deps, actor, site_id, post_id)),
  );

  server.registerTool(
    'create_post',
    {
      description:
        'Create a post or page from HTML you wrote. Categories and tags are names; existing categories are reused. Use set_post_seo afterwards.',
      inputSchema: {
        site_id: siteId,
        title: z.string().min(1),
        content_html: z.string(),
        type: z.enum(['post', 'page']).default('post'),
        status: status.default('draft'),
        scheduled_at: scheduledAt.optional(),
        excerpt: z.string().optional(),
        categories: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    ({ site_id, type, ...args }) => run(() => createPost(deps, actor, site_id, { type, ...postFields(args) })),
  );

  server.registerTool(
    'update_post',
    {
      description:
        'Change fields of a post or page. Omitted fields stay as they are. Set status to publish, schedule, or revert to draft.',
      inputSchema: {
        site_id: siteId,
        post_id: postId,
        title: z.string().optional(),
        content_html: z.string().optional(),
        excerpt: z.string().optional(),
        status: status.optional(),
        scheduled_at: scheduledAt.optional(),
        categories: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    ({ site_id, post_id, ...args }) => run(() => updatePost(deps, actor, site_id, post_id, postFields(args))),
  );

  server.registerTool(
    'trash_post',
    {
      description: 'Move a post or page to the WordPress trash (recoverable there).',
      inputSchema: { site_id: siteId, post_id: postId },
      annotations: { destructiveHint: true },
    },
    ({ site_id, post_id }) => run(() => trashPost(deps, actor, site_id, post_id)),
  );

  server.registerTool(
    'set_post_seo',
    {
      description:
        'Write the SEO title, meta description and focus keyword into the site’s SEO plugin (Yoast, Rank Math or AIOSEO).',
      inputSchema: {
        site_id: siteId,
        post_id: postId,
        seo_title: z.string().optional(),
        meta_description: z.string().optional(),
        focus_keyword: z.string().optional(),
      },
    },
    ({ site_id, post_id, seo_title, meta_description, focus_keyword }) =>
      run(() =>
        setPostSeo(deps, actor, site_id, post_id, {
          ...(seo_title !== undefined && { title: seo_title }),
          ...(meta_description !== undefined && { description: meta_description }),
          ...(focus_keyword !== undefined && { focus_keyword }),
        }),
      ),
  );

  server.registerTool(
    'list_categories',
    {
      description: 'List the site’s categories.',
      inputSchema: { site_id: siteId },
      annotations: { readOnlyHint: true },
    },
    ({ site_id }) => run(() => listTerms(deps, actor, site_id, 'category')),
  );

  server.registerTool(
    'list_tags',
    { description: 'List the site’s tags.', inputSchema: { site_id: siteId }, annotations: { readOnlyHint: true } },
    ({ site_id }) => run(() => listTerms(deps, actor, site_id, 'post_tag')),
  );

  server.registerTool(
    'generate_featured_image',
    {
      description: 'Generate an AI image, upload it, and set it as the post’s featured image.',
      inputSchema: { site_id: siteId, post_id: postId, prompt: z.string().optional() },
    },
    ({ site_id, post_id, prompt }) => run(() => generateFeaturedImage(deps, actor, site_id, post_id, { prompt })),
  );

  server.registerTool(
    'list_templates',
    {
      description:
        'Content templates (what to write) and design templates (how it looks) usable with generate_article.',
      inputSchema: { kind: z.enum(['content', 'design']).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ kind }) =>
      run(async () =>
        (await listTemplates(deps, actor, kind)).map(({ id, kind: k, name, description }) => ({
          id,
          kind: k,
          name,
          description,
        })),
      ),
  );

  server.registerTool(
    'generate_article',
    {
      description:
        'Have TriCity Writer write a full article with images and SEO metadata. Runs in the background: poll get_article with the returned id. "review" keeps it for review in the dashboard; "draft"/"publish" push it to WordPress when done.',
      inputSchema: {
        site_id: siteId,
        topic: z.string().min(3),
        keywords: z.string().optional().describe('Comma-separated; the first is the focus keyword.'),
        words: z.number().int().min(300).max(5000).default(1200),
        content_template_id: z.string().optional(),
        design_template_id: z.string().optional(),
        instructions: z.string().optional(),
        featured_image: z.boolean().default(true),
        inline_images: z.number().int().min(0).max(6).default(0),
        deliver: z.enum(['review', 'draft', 'publish']).default('draft'),
      },
    },
    (args) =>
      run(async () => {
        const generation = await createGeneration(
          deps,
          actor,
          {
            siteId: args.site_id,
            topic: args.topic,
            keywords: args.keywords ?? '',
            words: args.words,
            contentTemplateId: args.content_template_id,
            designTemplateId: args.design_template_id,
            instructions: args.instructions ?? '',
            featuredImage: args.featured_image,
            inlineImages: args.inline_images,
            delivery: args.deliver === 'review' ? { mode: 'review' } : { mode: 'publish', status: args.deliver },
          },
          'mcp',
        );
        return { article_id: generation.id, status: generation.status };
      }),
  );

  server.registerTool(
    'get_article',
    {
      description: 'Status and result of a generate_article job.',
      inputSchema: { article_id: z.string(), include_html: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    ({ article_id, include_html }) =>
      run(async () => {
        const g = await getGeneration(deps, actor, article_id);
        const output = g.output as GenerationOutput | null;
        return {
          article_id: g.id,
          status: g.status,
          topic: g.topic,
          error: g.error,
          title: output?.title,
          seo_score: g.seoScore,
          warnings: output?.warnings,
          wordpress: g.wpPostId ? { post_id: g.wpPostId, url: g.wpPostUrl, status: g.wpPostStatus } : null,
          ...(include_html && output && { html: output.html }),
        };
      }),
  );

  server.registerTool(
    'publish_article',
    {
      description: 'Push a finished (status "ready") article to WordPress as a draft, published or scheduled post.',
      inputSchema: {
        article_id: z.string(),
        status: z.enum(['draft', 'publish', 'future']),
        scheduled_at: scheduledAt.optional(),
      },
    },
    ({ article_id, status: publishStatus, scheduled_at }) =>
      run(async () => {
        const g = await requestPublish(deps, actor, article_id, { status: publishStatus, scheduledAt: scheduled_at });
        return { article_id: g.id, status: g.status };
      }),
  );

  server.registerTool(
    'autoblog_status',
    {
      description: 'Auto-blogging settings, queued topics and recent runs for a site.',
      inputSchema: { site_id: siteId },
      annotations: { readOnlyHint: true },
    },
    ({ site_id }) =>
      run(async () => {
        const { profile, queue, history } = await getAutoblog(deps, actor, site_id);
        return {
          profile,
          queued_topics: queue.map((t) => t.topic),
          recent_runs: history.map((g) => ({ article_id: g.id, topic: g.topic, status: g.status, url: g.wpPostUrl })),
        };
      }),
  );

  server.registerTool(
    'autoblog_add_topics',
    {
      description: 'Add topics to a site’s auto-blogging queue. Each run writes about the oldest queued topic.',
      inputSchema: { site_id: siteId, topics: z.array(z.string().min(3)).min(1).max(200) },
    },
    ({ site_id, topics }) =>
      run(async () => ({
        added: (
          await addAutoblogTopics(
            deps,
            actor,
            site_id,
            topics.map((topic) => ({ topic })),
          )
        ).length,
      })),
  );

  server.registerTool(
    'autoblog_run_now',
    {
      description: 'Run auto-blogging once now for a site, using the next queued topic.',
      inputSchema: { site_id: siteId },
    },
    ({ site_id }) => run(() => triggerAutoblogRun(deps, actor, site_id)),
  );

  return server;
}

// Stateless Streamable HTTP: a fresh server and transport per request, so any API instance can
// serve any request. Accepts bearer MCP keys (created in Settings) and, when MCP sign-in is enabled,
// OAuth access tokens issued by our authorization server.
export interface McpAuth {
  verifyOAuthToken?: (token: string) => Promise<Required<Actor> | null>;
  // RFC 9728 metadata URL advertised to unauthenticated clients so they can start OAuth.
  resourceMetadataUrl?: string;
}

export function registerMcp(app: FastifyInstance, deps: CoreDeps, version: string, auth: McpAuth = {}): void {
  app.post('/mcp', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const actor = !token
      ? null
      : token.startsWith('tcw_mcp_')
        ? await verifyMcpKey(deps, token)
        : ((await auth.verifyOAuthToken?.(token)) ?? null);

    if (!actor) {
      const challenge = auth.resourceMetadataUrl
        ? `Bearer resource_metadata="${auth.resourceMetadataUrl}"${token ? ', error="invalid_token"' : ''}`
        : 'Bearer realm="tricity-writer"';
      return reply
        .code(401)
        .header('www-authenticate', challenge)
        .send({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid credentials.' }, id: null });
    }

    const server = createMcpServer(deps, actor, version);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(toFetchRequest(request), { parsedBody: request.body });
      return await sendResponse(reply, response);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  const methodNotAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
