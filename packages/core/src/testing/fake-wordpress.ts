import { CONNECTOR_TOKEN_HEADER, type Media, type Post, type SeoFields, type Term } from '@tricity/shared';

// In-memory stand-in for a WordPress site running the connector plugin, as a fetch implementation.
// Mirrors the plugin's routes closely enough for service and API tests; the real plugin is covered
// by e2e/connector.e2e.ts against WordPress Playground.

export interface FakeWordPress {
  fetch: typeof fetch;
  // Pairing codes the site will accept (single use).
  codes: Set<string>;
  posts: Map<number, Post>;
  media: Map<number, Media & { bytes: number }>;
  categories: Term[];
  requests: { method: string; route: string }[];
  revokeAll(): void;
}

const EMPTY_SEO: SeoFields = { title: '', description: '', focus_keyword: '' };

export function fakeWordPress(siteUrl = 'https://blog.example.com'): FakeWordPress {
  const tokens = new Set<string>();
  let nextId = 100;
  const site = {
    name: 'Example Blog',
    url: siteUrl,
    wp_version: '6.8',
    plugin_version: '0.1.0',
    seo_plugin: 'yoast' as const,
  };

  const state: FakeWordPress = {
    codes: new Set(['GOOD-CODE-0001']),
    posts: new Map(),
    media: new Map(),
    categories: [{ id: 1, name: 'Uncategorized', slug: 'uncategorized', parent: 0, count: 0 }],
    requests: [],
    revokeAll: () => tokens.clear(),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (!url.href.startsWith(siteUrl)) return new Response('not found', { status: 404 });
      const route =
        url.searchParams.get('rest_route') ??
        url.pathname.slice(new URL(siteUrl).pathname.replace(/\/$/, '').length).replace(/^\/wp-json/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const token = new Headers(init?.headers).get(CONNECTOR_TOKEN_HEADER);
      state.requests.push({ method, route });

      const ns = '/tricity-writer/v1';
      if (!route.startsWith(ns))
        return json({ code: 'rest_no_route', message: 'No route', data: { status: 404 } }, 404);
      const path = route.slice(ns.length);

      if (path === '/ping') return json({ plugin: 'tricity-writer', version: '0.1.0' });
      if (path === '/pair' && method === 'POST') {
        if (!state.codes.delete(body.code)) return wpError('tcw_invalid_code', 403);
        const issued = `tcw_${Math.random().toString(36).slice(2)}`;
        tokens.add(issued);
        return json({ connection_id: 'conn-1', token: issued, connection_name: 'Test', site });
      }
      if (!token || !tokens.has(token)) return wpError('tcw_invalid_token', 401);

      if (path === '/status') {
        return json({
          connection_id: 'conn-1',
          connection_name: 'Test',
          user: { id: 1, display_name: 'admin' },
          capabilities: {
            publish_posts: true,
            edit_pages: true,
            upload_files: true,
            manage_categories: true,
            unfiltered_html: true,
          },
          site,
        });
      }
      if (path === '/disconnect') {
        tokens.delete(token);
        return json({ ok: true });
      }
      if (path === '/terms') return json(url.searchParams.get('taxonomy') === 'category' ? state.categories : []);
      if (path === '/media' && method === 'POST') {
        const id = nextId++;
        const media = {
          id,
          url: `${siteUrl}/wp-content/uploads/${body.filename}`,
          mime_type: body.mime_type,
          width: 1536,
          height: 1024,
          alt: body.alt ?? '',
          bytes: Buffer.from(body.data, 'base64').length,
        };
        state.media.set(id, media);
        return json(media);
      }
      if (path === '/posts' && method === 'GET') {
        const items = [...state.posts.values()].filter((p) => p.status !== 'trash');
        return json({ items, total: items.length, pages: 1 });
      }
      if (path === '/posts' && method === 'POST') {
        const id = nextId++;
        const post = applyFields(
          {
            id,
            type: body.type ?? 'post',
            title: '',
            status: 'draft',
            date_gmt: new Date().toISOString(),
            modified_gmt: new Date().toISOString(),
            link: `${siteUrl}/?p=${id}`,
            word_count: 0,
            has_featured_image: false,
            content: '',
            excerpt: '',
            categories: [],
            tags: [],
            featured_media: null,
            featured_image_url: null,
            author: { id: 1, display_name: 'admin' },
            seo: { ...EMPTY_SEO },
          },
          body,
        );
        state.posts.set(id, post);
        return json(post);
      }

      const match = path.match(/^\/posts\/(\d+)(\/seo|\/trash)?$/);
      const post = match ? state.posts.get(Number(match[1])) : undefined;
      if (match && !post) return wpError('tcw_not_found', 404);
      if (post && match?.[2] === '/seo') {
        post.seo = { ...post.seo, ...body };
        return json(post.seo);
      }
      if (post && match?.[2] === '/trash') {
        post.status = 'trash';
        return json({ ok: true });
      }
      if (post && method === 'GET') return json(post);
      if (post && method === 'POST') return json(applyFields(post, body));
      return wpError('rest_no_route', 404);
    },
  };

  function applyFields(post: Post, body: Record<string, unknown>): Post {
    for (const key of ['title', 'content', 'excerpt', 'status', 'date_gmt', 'categories', 'tags'] as const) {
      if (body[key] !== undefined) (post as Record<string, unknown>)[key] = body[key];
    }
    if ('featured_media' in body) {
      post.featured_media = (body.featured_media as number | null) ?? null;
      post.has_featured_image = post.featured_media !== null;
      post.featured_image_url = post.featured_media ? (state.media.get(post.featured_media)?.url ?? null) : null;
    }
    post.word_count = String(post.content)
      .replace(/<[^>]+>/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;
    return post;
  }

  return state;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function wpError(code: string, status: number): Response {
  return json({ code, message: code, data: { status } }, status);
}
