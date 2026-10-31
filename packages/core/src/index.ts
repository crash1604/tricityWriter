// Domain services shared by apps/api (REST + MCP) and apps/worker. Every function takes CoreDeps and,
// for user-initiated work, an Actor that pins it to one organization.
export { memberRole, type Role, requireAdmin } from './access';
export { createAiService } from './ai';
export * from './ai-keys';
export * from './autoblog';
export * from './crypto';
export type { Actor, CoreDeps, JobQueue } from './deps';
export * from './errors';
export { fakeArticle } from './generation/fake';
export { previewImagePlaceholders, sanitizeArticleHtml } from './generation/html';
export * from './generation/pipeline';
export * from './generation/types';
export * from './mcp-keys';
export * from './posts';
export { type SeoCheck, type SeoScore, scoreArticle } from './seo-score';
export * from './sites';
export * from './templates';
export { normalizeSiteUrl } from './urls';
export * from './usage';
