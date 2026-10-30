import { CONNECTOR_TOKEN_HEADER } from '@tricity/shared';
import { describe, expect, it } from 'vitest';
import { ConnectorClient, ConnectorError } from './index';

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

function html(status = 200): Response {
  return new Response('<!doctype html><html></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
}

function fakeFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

const site = {
  name: 'Test',
  url: 'https://example.com/blog',
  wp_version: '6.8',
  plugin_version: '0.1.0',
  seo_plugin: null,
};

describe('ConnectorClient', () => {
  it('uses /wp-json/ and strips trailing slashes from a subdirectory install', async () => {
    const { impl, calls } = fakeFetch(json({ plugin: 'tricity-writer', version: '0.1.0' }));
    const client = new ConnectorClient({ siteUrl: 'https://example.com/blog/', fetch: impl });

    await expect(client.ping()).resolves.toEqual({ plugin: 'tricity-writer', version: '0.1.0' });
    expect(calls[0]?.url).toBe('https://example.com/blog/wp-json/tricity-writer/v1/ping');
    expect(client.routeStyle).toBe('pretty');
  });

  it('falls back to ?rest_route= when /wp-json/ returns HTML, then remembers it', async () => {
    const { impl, calls } = fakeFetch(
      html(404),
      json({ plugin: 'tricity-writer', version: '0.1.0' }),
      json({ plugin: 'tricity-writer', version: '0.1.0' }),
    );
    const client = new ConnectorClient({ siteUrl: 'https://example.com', fetch: impl });

    await client.ping();
    await client.ping();

    expect(calls.map((c) => c.url)).toEqual([
      'https://example.com/wp-json/tricity-writer/v1/ping',
      'https://example.com/?rest_route=%2Ftricity-writer%2Fv1%2Fping',
      'https://example.com/?rest_route=%2Ftricity-writer%2Fv1%2Fping',
    ]);
    expect(client.routeStyle).toBe('query');
  });

  it('throws tcw_rest_unreachable when neither style returns JSON', async () => {
    const { impl } = fakeFetch(html(), html());
    const client = new ConnectorClient({ siteUrl: 'https://example.com', fetch: impl });

    await expect(client.ping()).rejects.toMatchObject({ code: 'tcw_rest_unreachable' });
  });

  it('sends the token in the custom header', async () => {
    const status = {
      connection_id: 'c1',
      connection_name: 'Dashboard',
      user: { id: 1, display_name: 'admin' },
      capabilities: {
        publish_posts: true,
        edit_pages: true,
        upload_files: true,
        manage_categories: true,
        unfiltered_html: true,
      },
      site,
    };
    const { impl, calls } = fakeFetch(json(status));
    const client = new ConnectorClient({ siteUrl: 'https://example.com', token: 'secret', fetch: impl });

    await expect(client.status()).resolves.toEqual(status);
    expect(new Headers(calls[0]?.init.headers).get(CONNECTOR_TOKEN_HEADER)).toBe('secret');
  });

  it('appends query parameters in both URL styles', () => {
    const client = new ConnectorClient({ siteUrl: 'https://example.com' });
    const query = { type: 'post', search: 'a b', page: 2, status: undefined };

    expect(client.urlFor('/posts', 'pretty', query)).toBe(
      'https://example.com/wp-json/tricity-writer/v1/posts?type=post&search=a+b&page=2',
    );
    expect(client.urlFor('/posts', 'query', query)).toBe(
      'https://example.com/?rest_route=%2Ftricity-writer%2Fv1%2Fposts&type=post&search=a+b&page=2',
    );
  });

  it('rejects authenticated calls without a token before any request', async () => {
    const { impl, calls } = fakeFetch();
    const client = new ConnectorClient({ siteUrl: 'https://example.com', fetch: impl });

    await expect(client.listPosts()).rejects.toMatchObject({ code: 'tcw_missing_token' });
    expect(calls).toHaveLength(0);
  });

  it('reports contract mismatches instead of raw validation errors', async () => {
    const { impl } = fakeFetch(json({ unexpected: true }));
    const client = new ConnectorClient({ siteUrl: 'https://example.com', token: 't', fetch: impl });

    await expect(client.getPost(1)).rejects.toMatchObject({ code: 'tcw_contract_mismatch' });
  });

  it('maps WP_Error bodies to ConnectorError', async () => {
    const { impl } = fakeFetch(
      json({ code: 'tcw_invalid_code', message: 'Invalid or expired pairing code.', data: { status: 403 } }, 403),
    );
    const client = new ConnectorClient({ siteUrl: 'https://example.com', fetch: impl });

    const error = await client.pair('NOPE').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ status: 403, code: 'tcw_invalid_code' });
  });
});
