// The only module that talks to WordPress sites. REST routes, MCP tools and the worker all go through it.
import {
  CONNECTOR_NAMESPACE,
  CONNECTOR_TOKEN_HEADER,
  type ListPostsQuery,
  type ListPostsResponse,
  type ListTermsQuery,
  listPostsResponseSchema,
  type Media,
  mediaSchema,
  okResponseSchema,
  type PairResponse,
  type PingResponse,
  type Post,
  pairResponseSchema,
  pingResponseSchema,
  postSchema,
  type SeoFields,
  type StatusResponse,
  seoFieldsSchema,
  statusResponseSchema,
  type Term,
  termSchema,
  type UploadMedia,
  type UpsertPost,
  wpErrorSchema,
} from '@tricity/shared';
import { z } from 'zod';
import { blockedAddressIn, createSiteFetch } from './network';

export { BlockedAddressError, createSiteFetch, isPublicAddress, type SiteFetchOptions } from './network';

// `pretty` = /wp-json/<route>; `query` = /?rest_route=/<route>, for sites where /wp-json/ is
// rewritten to HTML (plain permalinks, broken rewrite rules, some security plugins).
export type RouteStyle = 'pretty' | 'query';

type Parser<T> = { parse(data: unknown): T };
type Query = Record<string, string | number | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class ConnectorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ConnectorError';
    this.status = status;
    this.code = code;
  }
}

export interface ConnectorClientOptions {
  siteUrl: string;
  token?: string;
  // Skip discovery when the working style is already known (stored per site).
  routeStyle?: RouteStyle;
  userAgent?: string;
  // Defaults to a fetch that refuses private and reserved addresses (see ./network).
  fetch?: typeof fetch;
}

let sharedSiteFetch: typeof fetch | undefined;
// One guarded fetch (and connection pool) for every client that doesn't bring its own.
function defaultSiteFetch(): typeof fetch {
  if (!sharedSiteFetch) sharedSiteFetch = createSiteFetch();
  return sharedSiteFetch;
}

export class ConnectorClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly userAgent: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private style: RouteStyle | undefined;

  constructor(options: ConnectorClientOptions) {
    this.baseUrl = options.siteUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetch ?? defaultSiteFetch();
    this.style = options.routeStyle;
  }

  // The style that last returned JSON; persist it with the site to skip discovery next time.
  get routeStyle(): RouteStyle | undefined {
    return this.style;
  }

  ping(): Promise<PingResponse> {
    return this.request('GET', '/ping', pingResponseSchema);
  }

  pair(code: string, platformUrl?: string): Promise<PairResponse> {
    return this.request('POST', '/pair', pairResponseSchema, { body: { code, platform_url: platformUrl } });
  }

  status(platformUrl?: string): Promise<StatusResponse> {
    return this.authed('GET', '/status', statusResponseSchema, { query: { platform_url: platformUrl } });
  }

  // Revokes this client's own connection on the site.
  async disconnect(): Promise<void> {
    await this.authed('POST', '/disconnect', okResponseSchema);
  }

  listPosts(query: ListPostsQuery = {}): Promise<ListPostsResponse> {
    return this.authed('GET', '/posts', listPostsResponseSchema, { query });
  }

  getPost(id: number): Promise<Post> {
    return this.authed('GET', `/posts/${id}`, postSchema);
  }

  createPost(post: UpsertPost): Promise<Post> {
    return this.authed('POST', '/posts', postSchema, { body: post });
  }

  updatePost(id: number, patch: UpsertPost): Promise<Post> {
    return this.authed('POST', `/posts/${id}`, postSchema, { body: patch });
  }

  async trashPost(id: number): Promise<void> {
    await this.authed('POST', `/posts/${id}/trash`, okResponseSchema);
  }

  setSeo(id: number, fields: Partial<SeoFields>): Promise<SeoFields> {
    return this.authed('POST', `/posts/${id}/seo`, seoFieldsSchema, { body: fields });
  }

  listTerms(query: ListTermsQuery): Promise<Term[]> {
    return this.authed('GET', '/terms', z.array(termSchema), { query });
  }

  uploadMedia(media: UploadMedia): Promise<Media> {
    return this.authed('POST', '/media', mediaSchema, { body: media, timeoutMs: UPLOAD_TIMEOUT_MS });
  }

  urlFor(route: string, style: RouteStyle, query: Query = {}): string {
    const path = `/${CONNECTOR_NAMESPACE}${route}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const extra = params.toString();
    return style === 'pretty'
      ? `${this.baseUrl}/wp-json${path}${extra ? `?${extra}` : ''}`
      : `${this.baseUrl}/?rest_route=${encodeURIComponent(path)}${extra ? `&${extra}` : ''}`;
  }

  private authed<T>(
    method: string,
    route: string,
    parser: Parser<T>,
    options: { body?: unknown; query?: Query; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!this.token) {
      return Promise.reject(new ConnectorError(`${route} requires a connection token`, 0, 'tcw_missing_token'));
    }
    return this.request(method, route, parser, options);
  }

  private async request<T>(
    method: string,
    route: string,
    parser: Parser<T>,
    options: { body?: unknown; query?: Query; timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.style) {
      return this.handle(await this.send(method, route, this.style, options), parser);
    }

    for (const style of ['pretty', 'query'] as const) {
      const response = await this.send(method, route, style, options);
      if (isJson(response)) {
        this.style = style;
        return this.handle(response, parser);
      }
    }
    throw new ConnectorError(`No WordPress REST API found at ${this.baseUrl}`, 0, 'tcw_rest_unreachable');
  }

  private async send(
    method: string,
    route: string,
    style: RouteStyle,
    options: { body?: unknown; query?: Query; timeoutMs?: number },
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers[CONNECTOR_TOKEN_HEADER] = this.token;
    if (this.userAgent) headers['User-Agent'] = this.userAgent;

    try {
      return await this.fetchImpl(this.urlFor(route, style, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error) {
      if (blockedAddressIn(error)) {
        throw new ConnectorError(
          `${new URL(this.baseUrl).host} points to a private or reserved network address. Use the site's public address.`,
          0,
          'tcw_blocked_address',
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConnectorError(`Could not reach ${this.baseUrl}: ${reason}`, 0, 'tcw_unreachable');
    }
  }

  private async handle<T>(response: Response, parser: Parser<T>): Promise<T> {
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ConnectorError('Site returned a non-JSON response', response.status, 'tcw_invalid_json');
    }

    if (!response.ok) {
      const error = wpErrorSchema.safeParse(data);
      throw error.success
        ? new ConnectorError(error.data.message, response.status, error.data.code)
        : new ConnectorError(`HTTP ${response.status}`, response.status, 'tcw_http_error');
    }
    try {
      return parser.parse(data);
    } catch {
      throw new ConnectorError(
        'Unexpected response from the connector plugin. Is it up to date?',
        response.status,
        'tcw_contract_mismatch',
      );
    }
  }
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('json');
}
