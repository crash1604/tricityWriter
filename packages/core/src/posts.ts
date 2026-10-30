import { forOrg } from '@tricity/db';
import type { ListPostsQuery, Media, Post, SeoFields, Term, UpsertPost } from '@tricity/shared';
import type { Actor, CoreDeps } from './deps';
import { AppError, invalid } from './errors';
import { optimizeImage } from './generation/images';
import { withSite } from './sites';
import { slugify } from './urls';

// Direct content operations on a connected site. Used by the dashboard and MCP; no AI involved
// except generateFeaturedImage().

export function listPosts(deps: CoreDeps, actor: Actor, siteId: string, query: ListPostsQuery = {}) {
  return withSite(deps, actor, siteId, (wp) => wp.listPosts(query));
}

export function getPost(deps: CoreDeps, actor: Actor, siteId: string, postId: number): Promise<Post> {
  return withSite(deps, actor, siteId, (wp) => wp.getPost(postId));
}

export function createPost(deps: CoreDeps, actor: Actor, siteId: string, post: UpsertPost): Promise<Post> {
  if (post.status === 'future' && !post.date_gmt) throw invalid('Scheduling needs a date (date_gmt).');
  return withSite(deps, actor, siteId, (wp) => wp.createPost(post));
}

export function updatePost(deps: CoreDeps, actor: Actor, siteId: string, postId: number, patch: UpsertPost) {
  return withSite(deps, actor, siteId, (wp) => wp.updatePost(postId, patch));
}

export function trashPost(deps: CoreDeps, actor: Actor, siteId: string, postId: number): Promise<void> {
  return withSite(deps, actor, siteId, (wp) => wp.trashPost(postId));
}

export function setPostSeo(deps: CoreDeps, actor: Actor, siteId: string, postId: number, fields: Partial<SeoFields>) {
  return withSite(deps, actor, siteId, (wp) => wp.setSeo(postId, fields));
}

export function listTerms(
  deps: CoreDeps,
  actor: Actor,
  siteId: string,
  taxonomy: 'category' | 'post_tag',
  search?: string,
): Promise<Term[]> {
  return withSite(deps, actor, siteId, (wp) => wp.listTerms({ taxonomy, search }));
}

// Generates an image, optimizes it, uploads it and makes it the post's featured image.
export async function generateFeaturedImage(
  deps: CoreDeps,
  actor: Actor,
  siteId: string,
  postId: number,
  options: { prompt?: string; model?: string } = {},
): Promise<Media> {
  const model = options.model ?? deps.ai.defaultModel('image')?.id;
  if (!model) throw new AppError('ai_unavailable', 'No image model is available. Add an OpenAI API key.');

  return withSite(deps, actor, siteId, async (wp, site) => {
    const post = await wp.getPost(postId);
    const prompt =
      options.prompt ?? `Editorial photograph for an article titled "${post.title}". No text, no logos, no watermarks.`;
    const scope = forOrg(deps.db, actor.orgId);
    const image = await deps.ai.generateImage(model, { prompt, size: '1536x1024' }, (usage) =>
      scope.usage.record({ ...usage, siteId: site.id }),
    );
    const optimized = await optimizeImage(image.data);
    const media = await wp.uploadMedia({
      filename: `${slugify(post.title)}-featured.webp`,
      mime_type: 'image/webp',
      data: optimized.data.toString('base64'),
      alt: post.title,
      post_id: postId,
    });
    await wp.updatePost(postId, { featured_media: media.id });
    return media;
  });
}
