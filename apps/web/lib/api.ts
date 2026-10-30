// Typed client for apps/api's /api/v1. Types mirror the API responses; keep them in sync with
// apps/api/src/routes/*.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.location.href = '/sign-in';
    throw new ApiError(
      data?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      data?.error?.code ?? 'error',
    );
  }
  return data as T;
}

export interface Site {
  id: string;
  name: string;
  url: string;
  homeUrl: string | null;
  status: 'connected' | 'disconnected' | 'error';
  statusMessage: string | null;
  lastCheckedAt: string | null;
  wpVersion: string | null;
  pluginVersion: string | null;
  seoPlugin: 'yoast' | 'rankmath' | 'aioseo' | null;
  contentPrompt: string;
  designPrompt: string;
  createdAt: string;
}

export interface SiteStatus {
  user: { id: number; display_name: string };
  capabilities: Record<
    'publish_posts' | 'edit_pages' | 'upload_files' | 'manage_categories' | 'unfiltered_html',
    boolean
  >;
}

export interface WpPostSummary {
  id: number;
  type: 'post' | 'page';
  title: string;
  status: string;
  date_gmt: string;
  link: string;
  word_count: number;
  has_featured_image: boolean;
}

export type GenerationStatus = 'queued' | 'generating' | 'ready' | 'publishing' | 'published' | 'failed';

export interface SeoCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface GenerationOutput {
  title: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  html: string;
  previewHtml: string;
  featuredImageUrl: string | null;
  images: { slot: number; prompt: string; alt: string }[];
  seo: { score: number; checks: SeoCheck[] };
  textModel: string;
  imageModel: string | null;
  warnings: string[];
}

export interface GenerationOptions {
  words: number;
  contentTemplateId?: string;
  designTemplateId?: string;
  instructions: string;
  designInstructions: string;
  textModel?: string;
  imageModel?: string;
  featuredImage: boolean;
  inlineImages: number;
  imageStyle: string;
  postType: 'post' | 'page';
}

export interface Generation {
  id: string;
  siteId: string;
  source: 'wizard' | 'autoblog' | 'mcp';
  status: GenerationStatus;
  topic: string;
  input: GenerationOptions & { keywords: string };
  output: GenerationOutput | null;
  seoScore: number | null;
  wpPostId: number | null;
  wpPostUrl: string | null;
  wpPostStatus: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type GenerationSummary = Omit<Generation, 'output'> & { title: string | null };

export interface Template {
  id: string;
  kind: 'content' | 'design';
  name: string;
  description: string;
  prompt: string;
  builtIn: boolean;
}

export interface Model {
  id: string;
  label: string;
  description: string;
  kind: 'text' | 'image';
  provider: string;
  available: boolean;
}

export interface ModelsResponse {
  models: Model[];
  defaults: { text: string | null; image: string | null };
  fake: boolean;
}

export interface AutoblogProfile {
  enabled: boolean;
  mode: 'assist' | 'guarded' | 'autopilot';
  threshold: number;
  schedule: string;
  timezone: string;
  settings: GenerationOptions;
}

export interface AutoblogState {
  profile: AutoblogProfile;
  queue: { id: string; topic: string; keywords: string; createdAt: string }[];
  history: Generation[];
}

export interface McpKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface UsageSummary {
  since: string;
  articles: number;
  byModel: {
    kind: 'text' | 'image';
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    costMicroUsd: number;
  }[];
  totals: { inputTokens: number; outputTokens: number; images: number; costUsd: number };
}

export interface Me {
  user: { id: string; name: string; email: string };
  organizationId: string;
  organizations: { id: string; name: string; slug: string }[];
}
