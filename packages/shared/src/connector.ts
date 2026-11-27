// Contract between the platform and the WordPress connector plugin.
// plugins/tricity-writer/src/Rest/*.php mirrors this file; change both together.
// All writes use POST: many hosts and WAFs block PUT/PATCH/DELETE.
import { z } from 'zod';

export const CONNECTOR_NAMESPACE = 'tricity-writer/v1';

// Preferred over `Authorization: Bearer`, which many hosts strip before PHP sees it.
export const CONNECTOR_TOKEN_HEADER = 'X-TCW-Token';

export const pingResponseSchema = z.object({
  plugin: z.literal('tricity-writer'),
  version: z.string(),
});
export type PingResponse = z.infer<typeof pingResponseSchema>;

export const pairRequestSchema = z.object({
  code: z.string().min(1),
  // The dashboard's public address. The plugin reads its version manifest from there to offer its own
  // updates in WP admin (Updater.php); it never sends site data to it.
  platform_url: z.url().optional(),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

export const seoPluginSchema = z.enum(['yoast', 'rankmath', 'aioseo']).nullable();
export type SeoPlugin = z.infer<typeof seoPluginSchema>;

export const siteInfoSchema = z.object({
  name: z.string(),
  url: z.string(),
  wp_version: z.string(),
  plugin_version: z.string(),
  seo_plugin: seoPluginSchema,
});
export type SiteInfo = z.infer<typeof siteInfoSchema>;

export const pairResponseSchema = z.object({
  connection_id: z.string(),
  token: z.string(),
  connection_name: z.string(),
  site: siteInfoSchema,
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

// GET /status query. platform_url plays the same role as in pairRequestSchema, so sites paired before
// the connector could update itself learn where updates come from.
export const statusQuerySchema = z.object({ platform_url: z.url().optional() });
export type StatusQuery = z.infer<typeof statusQuerySchema>;

export const statusResponseSchema = z.object({
  connection_id: z.string(),
  connection_name: z.string(),
  user: z.object({
    id: z.number().int(),
    display_name: z.string(),
  }),
  // What the connected WordPress user may do; the plugin enforces these on every request.
  capabilities: z.object({
    publish_posts: z.boolean(),
    edit_pages: z.boolean(),
    upload_files: z.boolean(),
    manage_categories: z.boolean(),
    unfiltered_html: z.boolean(),
  }),
  site: siteInfoSchema,
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const postTypeSchema = z.enum(['post', 'page']);
export type PostType = z.infer<typeof postTypeSchema>;

// Statuses we can set. Reads may also return 'pending' or 'trash'.
export const writablePostStatusSchema = z.enum(['draft', 'publish', 'future', 'private']);
export type WritablePostStatus = z.infer<typeof writablePostStatusSchema>;

export const seoFieldsSchema = z.object({
  title: z.string(),
  description: z.string(),
  focus_keyword: z.string(),
});
export type SeoFields = z.infer<typeof seoFieldsSchema>;

export const termSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().int(),
  count: z.number().int(),
});
export type Term = z.infer<typeof termSchema>;

export const postSummarySchema = z.object({
  id: z.number().int(),
  type: postTypeSchema,
  title: z.string(),
  status: z.string(),
  // ISO 8601, UTC.
  date_gmt: z.string(),
  modified_gmt: z.string(),
  link: z.string(),
  word_count: z.number().int(),
  has_featured_image: z.boolean(),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

export const postSchema = postSummarySchema.extend({
  content: z.string(),
  excerpt: z.string(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  featured_media: z.number().int().nullable(),
  featured_image_url: z.string().nullable(),
  author: z.object({ id: z.number().int(), display_name: z.string() }),
  seo: seoFieldsSchema,
});
export type Post = z.infer<typeof postSchema>;

export const listPostsQuerySchema = z.object({
  type: postTypeSchema.default('post'),
  status: z.enum(['any', 'draft', 'publish', 'future', 'private', 'pending']).default('any'),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  per_page: z.number().int().min(1).max(100).default(20),
});
export type ListPostsQuery = z.input<typeof listPostsQuerySchema>;

export const listPostsResponseSchema = z.object({
  items: z.array(postSummarySchema),
  total: z.number().int(),
  pages: z.number().int(),
});
export type ListPostsResponse = z.infer<typeof listPostsResponseSchema>;

// Create and update share one shape; on update every field is optional.
export const upsertPostSchema = z.object({
  type: postTypeSchema.optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  status: writablePostStatusSchema.optional(),
  // Required with status 'future'. ISO 8601.
  date_gmt: z.string().optional(),
  // Names, not ids. Missing categories are created when the user may manage them.
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  featured_media: z.number().int().nullable().optional(),
  author: z.number().int().optional(),
});
export type UpsertPost = z.infer<typeof upsertPostSchema>;

export const listTermsQuerySchema = z.object({
  taxonomy: z.enum(['category', 'post_tag']),
  search: z.string().optional(),
});
export type ListTermsQuery = z.infer<typeof listTermsQuerySchema>;

export const uploadMediaSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  // Base64 file contents.
  data: z.string().min(1),
  alt: z.string().default(''),
  title: z.string().optional(),
  post_id: z.number().int().optional(),
});
export type UploadMedia = z.input<typeof uploadMediaSchema>;

export const mediaSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  mime_type: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  alt: z.string(),
});
export type Media = z.infer<typeof mediaSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });

// Shape of WP_Error responses from the REST API.
export const wpErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  data: z.object({ status: z.number().int() }).partial().nullish(),
});
export type WpError = z.infer<typeof wpErrorSchema>;
