import { AiError, type OrgKeys, type UsageRecord } from '@tricity/ai';
import { forOrg, type Generation, type GenerationImage, type OrgScope } from '@tricity/db';
import type { GenerateJob, PublishJob, UpsertPost } from '@tricity/shared';
import { ConnectorError } from '@tricity/wp-client';
import { ZodError } from 'zod';
import { orgKeys } from '../ai-keys';
import type { Actor, CoreDeps } from '../deps';
import { AppError, errorMessage, invalid, notFound } from '../errors';
import { isUuid } from '../ids';
import { assertPlatformBudget, plannedModels, tooManyInProgress } from '../limits';
import { scoreArticle } from '../seo-score';
import { getSite, withSite } from '../sites';
import { getTemplate, type TemplateView } from '../templates';
import { slugify } from '../urls';
import { placeImageMarkers, resolveImagePlaceholders, sanitizeArticleHtml } from './html';
import { optimizeImage } from './images';
import { parseArticle } from './parse';
import { buildArticlePrompt } from './prompt';
import {
  type GeneratedImageSlot,
  type GenerationInput,
  type GenerationOutput,
  type GenerationRequest,
  generationInputSchema,
} from './types';

// Lifecycle: queued → generating → ready → publishing → published, or failed. "ready" means the
// article and its images are stored and can be reviewed, edited and published (again).

export async function createGeneration(
  deps: CoreDeps,
  actor: Actor,
  request: GenerationRequest,
  source: Generation['source'],
): Promise<Generation> {
  const input = parseInput(request);
  await getSite(deps, actor, input.siteId);
  await validateChoices(deps, actor, input);
  await assertBudgetFor(deps, actor.orgId, input);

  const max = deps.limits?.maxActiveGenerations;
  const generation = await forOrg(deps.db, actor.orgId).generations.createWithinLimit(
    { siteId: input.siteId, source, status: 'queued', topic: input.topic, input, createdBy: actor.userId ?? null },
    max,
  );
  if (!generation) throw tooManyInProgress(max ?? 0);
  await deps.jobs.generate({ orgId: actor.orgId, generationId: generation.id });
  return generation;
}

// Re-runs generation with the same input, replacing the article and images.
export async function regenerate(deps: CoreDeps, actor: Actor, generationId: string): Promise<Generation> {
  const scope = forOrg(deps.db, actor.orgId);
  const generation = await requireGeneration(scope, generationId);
  if (generation.status === 'generating' || generation.status === 'publishing' || generation.status === 'queued') {
    throw new AppError('conflict', 'This article is still being processed.');
  }
  await assertBudgetFor(deps, actor.orgId, parseInput(generation.input));
  const max = deps.limits?.maxActiveGenerations;
  const updated = await scope.generations.requeueWithinLimit(
    generationId,
    { status: 'queued', error: null, output: null, seoScore: null },
    max,
  );
  if (!updated) throw tooManyInProgress(max ?? 0);
  await deps.jobs.generate({ orgId: actor.orgId, generationId });
  return updated;
}

export async function getGeneration(deps: CoreDeps, actor: Actor, generationId: string): Promise<Generation> {
  return requireGeneration(forOrg(deps.db, actor.orgId), generationId);
}

export function listGenerations(
  deps: CoreDeps,
  actor: Actor,
  options: { siteId?: string; source?: Generation['source']; limit?: number } = {},
) {
  return forOrg(deps.db, actor.orgId).generations.list(options);
}

export async function getGenerationImage(
  deps: CoreDeps,
  actor: Actor,
  generationId: string,
  slot: number,
): Promise<GenerationImage> {
  if (!isUuid(generationId)) throw notFound('Image');
  const image = await forOrg(deps.db, actor.orgId).images.get(generationId, slot);
  if (!image) throw notFound('Image');
  return image;
}

export interface DraftEdit {
  title?: string;
  html?: string;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  excerpt?: string;
  categories?: string[];
  tags?: string[];
}

// Edits made in the review screen before (re)publishing. The SEO score is recomputed.
export async function editGeneration(
  deps: CoreDeps,
  actor: Actor,
  generationId: string,
  edit: DraftEdit,
): Promise<Generation> {
  const scope = forOrg(deps.db, actor.orgId);
  const generation = await requireGeneration(scope, generationId);
  if ((generation.status !== 'ready' && generation.status !== 'published') || !generation.output) {
    throw new AppError('conflict', 'Only finished articles can be edited.');
  }
  const input = parseInput(generation.input);
  const current = generation.output as GenerationOutput;
  const next: GenerationOutput = {
    ...current,
    ...stripUndefined(edit),
    html: edit.html === undefined ? current.html : sanitizeArticleHtml(edit.html),
  };
  next.seo = scoreArticle({ ...next, targetWords: input.words });
  const updated = await scope.generations.update(generationId, { output: next, seoScore: next.seo.score });
  return updated ?? generation;
}

// Queues publishing a ready article to WordPress (creating the post, or updating it if published before).
export async function requestPublish(
  deps: CoreDeps,
  actor: Actor,
  generationId: string,
  options: { status: PublishJob['status']; scheduledAt?: string },
): Promise<Generation> {
  const scope = forOrg(deps.db, actor.orgId);
  const generation = await requireGeneration(scope, generationId);
  if ((generation.status !== 'ready' && generation.status !== 'published') || !generation.output) {
    throw new AppError('conflict', 'This article is not ready to publish.');
  }
  validateSchedule(options);
  const updated = await scope.generations.update(generationId, { status: 'publishing', error: null });
  await deps.jobs.publish({ orgId: actor.orgId, generationId, ...options });
  return updated ?? generation;
}

// Worker: generate text, images and SEO data. `canRetry` is false on the last attempt.
export async function runGeneration(deps: CoreDeps, job: GenerateJob, canRetry = false): Promise<void> {
  const scope = forOrg(deps.db, job.orgId);
  const generation = await scope.generations.get(job.generationId);
  if (!generation || (generation.status !== 'queued' && generation.status !== 'generating')) return;

  await scope.generations.update(generation.id, { status: 'generating', startedAt: new Date(), error: null });
  try {
    const input = parseInput(generation.input);
    const output = await generateArticle(deps, scope, generation, input);
    await scope.generations.update(generation.id, {
      status: 'ready',
      output,
      seoScore: output.seo.score,
      finishedAt: new Date(),
    });

    const delivery = input.delivery;
    if (delivery.mode === 'publish') {
      await publishGeneration(deps, {
        orgId: job.orgId,
        generationId: generation.id,
        status: delivery.status,
        scheduledAt: delivery.scheduledAt,
      });
    } else if (delivery.mode === 'autoblog') {
      const status = autoblogStatus(delivery.policy, output.seo.score, delivery.threshold);
      if (delivery.policy === 'guarded' && status === 'draft') {
        await scope.generations.update(generation.id, {
          output: {
            ...output,
            warnings: [
              ...output.warnings,
              `Saved as a draft: SEO score ${output.seo.score} is below the publishing threshold of ${delivery.threshold}.`,
            ],
          },
        });
      }
      await publishGeneration(deps, { orgId: job.orgId, generationId: generation.id, status });
    }
  } catch (error) {
    if (canRetry && error instanceof AiError && error.retryable) {
      await scope.generations.update(generation.id, { status: 'queued', error: `Retrying: ${error.message}` });
      throw error;
    }
    await scope.generations.update(generation.id, {
      status: 'failed',
      error: errorMessage(error),
      finishedAt: new Date(),
    });
    if (!(error instanceof AppError || error instanceof AiError || error instanceof ConnectorError)) throw error;
  }
}

export function autoblogStatus(
  policy: 'assist' | 'guarded' | 'autopilot',
  score: number,
  threshold: number,
): 'draft' | 'publish' {
  if (policy === 'autopilot') return 'publish';
  if (policy === 'guarded' && score >= threshold) return 'publish';
  return 'draft';
}

async function generateArticle(
  deps: CoreDeps,
  scope: OrgScope,
  generation: Generation,
  input: GenerationInput,
): Promise<GenerationOutput> {
  const actor = { orgId: scope.orgId };
  const site = await getSite(deps, actor, input.siteId);
  const warnings: string[] = [];
  const meter = (usage: UsageRecord) => scope.usage.record({ ...usage, siteId: site.id, generationId: generation.id });

  const keys = await orgKeys(deps, scope.orgId);
  const textModel = input.textModel ?? deps.ai.defaultModel('text', keys)?.id;
  if (!textModel)
    throw new AppError('ai_unavailable', 'No text model is available. Add an Anthropic or OpenAI API key.');
  const imageModel = input.imageModel ?? deps.ai.defaultModel('image', keys)?.id ?? null;
  const wantsImages = input.featuredImage || input.inlineImages > 0;
  // Re-checked here because queued and scheduled (auto-blogging) articles start later.
  await assertPlatformBudget(deps, scope.orgId, keys, plannedModels(deps, keys, input));
  if (wantsImages && !imageModel)
    warnings.push('Images were skipped: no image model is available (add an OpenAI API key).');

  const existingCategories =
    input.postType === 'post'
      ? await withSite(deps, actor, site.id, (wp) => wp.listTerms({ taxonomy: 'category' }))
          .then((terms) => terms.map((t) => t.name))
          .catch(() => [])
      : [];

  const { system, prompt } = buildArticlePrompt({
    input,
    siteName: site.name,
    siteContentPrompt: site.contentPrompt,
    siteDesignPrompt: site.designPrompt,
    contentTemplate: await optionalTemplate(deps, actor, input.contentTemplateId),
    designTemplate: await optionalTemplate(deps, actor, input.designTemplateId),
    existingCategories,
    featuredImage: input.featuredImage && imageModel !== null,
    inlineImages: imageModel ? input.inlineImages : 0,
  });
  const result = await deps.ai.generateText(
    textModel,
    // Room for adaptive thinking plus long, markup-heavy HTML; streaming keeps this clear of timeouts.
    { system, prompt, maxOutputTokens: 64000 },
    meter,
    keys,
  );
  const article = parseArticle(result.text);

  // Images: slot 0 is the featured image, 1..n are inline.
  const requested: GeneratedImageSlot[] = [];
  if (imageModel) {
    if (input.featuredImage) {
      const featured = article.featuredImage ?? { prompt: `Editorial photo for: ${article.title}`, alt: article.title };
      requested.push({ slot: 0, ...featured });
    }
    for (const [slot, image] of article.inlineImages) {
      if (slot >= 1 && slot <= input.inlineImages) requested.push({ slot, ...image });
    }
  }
  const stored = await generateImages(
    deps,
    scope,
    generation.id,
    imageModel,
    requested,
    input.imageStyle,
    meter,
    warnings,
    keys,
  );

  const inline = new Map(stored.filter((s) => s.slot > 0).map((s) => [s.slot, s]));
  const html = sanitizeArticleHtml(placeImageMarkers(article.html, inline));
  const output: Omit<GenerationOutput, 'seo'> = {
    title: article.title,
    metaTitle: article.seoTitle,
    metaDescription: article.metaDescription,
    focusKeyword: article.focusKeyword,
    excerpt: article.excerpt,
    categories: input.postType === 'post' ? article.categories : [],
    tags: input.postType === 'post' ? article.tags : [],
    html,
    images: stored,
    textModel: result.servedBy,
    imageModel: stored.length ? imageModel : null,
    warnings,
  };
  return { ...output, seo: scoreArticle({ ...output, targetWords: input.words }) };
}

async function generateImages(
  deps: CoreDeps,
  scope: OrgScope,
  generationId: string,
  model: string | null,
  slots: GeneratedImageSlot[],
  style: string,
  meter: (usage: UsageRecord) => Promise<void>,
  warnings: string[],
  keys: OrgKeys,
): Promise<GeneratedImageSlot[]> {
  await scope.images.removeAll(generationId);
  if (!model) return [];

  const results = await Promise.allSettled(
    slots.map(async (slot) => {
      const prompt = `${slot.prompt}${style.trim() ? `. Style: ${style.trim()}` : ''}. No text, letters, logos or watermarks.`;
      const image = await deps.ai.generateImage(model, { prompt, size: '1536x1024' }, meter, keys);
      const optimized = await optimizeImage(image.data);
      await scope.images.put({
        generationId,
        slot: slot.slot,
        prompt: slot.prompt,
        alt: slot.alt,
        mimeType: optimized.mimeType,
        width: optimized.width,
        height: optimized.height,
        data: optimized.data,
      });
      return slot;
    }),
  );
  const stored: GeneratedImageSlot[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') stored.push(result.value);
    else
      warnings.push(
        `Image ${slots[i]?.slot === 0 ? '(featured)' : slots[i]?.slot} failed: ${errorMessage(result.reason)}`,
      );
  }
  return stored;
}

// Worker: upload images, create or update the WordPress post, and write SEO fields.
export async function publishGeneration(deps: CoreDeps, job: PublishJob): Promise<void> {
  const scope = forOrg(deps.db, job.orgId);
  const generation = await scope.generations.get(job.generationId);
  if (!generation?.output) return;
  const output = generation.output as GenerationOutput;
  const input = parseInput(generation.input);

  await scope.generations.update(generation.id, { status: 'publishing', error: null });
  try {
    const post = await withSite(deps, { orgId: job.orgId }, generation.siteId, async (wp) => {
      const urls = new Map<number, string>();
      let featuredMedia: number | null = null;
      for (const image of await scope.images.list(generation.id)) {
        let mediaId = image.wpMediaId;
        let url = image.wpUrl;
        if (!mediaId || !url) {
          const media = await wp.uploadMedia({
            filename: `${slugify(output.title)}-${image.slot === 0 ? 'featured' : image.slot}.webp`,
            mime_type: 'image/webp',
            data: image.data.toString('base64'),
            alt: image.alt,
            title: output.title,
          });
          mediaId = media.id;
          url = media.url;
          await scope.images.update(image.id, { wpMediaId: mediaId, wpUrl: url });
        }
        if (image.slot === 0) featuredMedia = mediaId;
        else urls.set(image.slot, url);
      }

      const fields: UpsertPost = {
        title: output.title,
        content: resolveImagePlaceholders(output.html, urls),
        excerpt: output.excerpt,
        status: job.status,
        featured_media: featuredMedia,
        ...(job.status === 'future' && { date_gmt: job.scheduledAt }),
        ...(input.postType === 'post' && { categories: output.categories, tags: output.tags }),
      };

      let saved = generation.wpPostId
        ? await wp.updatePost(generation.wpPostId, fields).catch((error: unknown) => {
            // The post was deleted in WordPress: publish it again as a new one.
            if (error instanceof ConnectorError && error.status === 404) return null;
            throw error;
          })
        : null;
      saved ??= await wp.createPost({ ...fields, type: input.postType });
      await wp.setSeo(saved.id, {
        title: output.metaTitle,
        description: output.metaDescription,
        focus_keyword: output.focusKeyword,
      });
      return saved;
    });

    await scope.generations.update(generation.id, {
      status: 'published',
      wpPostId: post.id,
      wpPostUrl: post.link,
      wpPostStatus: post.status,
      finishedAt: new Date(),
    });
  } catch (error) {
    await scope.generations.update(generation.id, {
      status: 'ready',
      error: `Publishing failed: ${errorMessage(error)}`,
    });
    if (!(error instanceof AppError || error instanceof ConnectorError)) throw error;
  }
}

function parseInput(value: unknown): GenerationInput {
  try {
    return generationInputSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw invalid(error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
    }
    throw error;
  }
}

async function validateChoices(deps: CoreDeps, actor: Actor, input: GenerationInput): Promise<void> {
  const keys = await orgKeys(deps, actor.orgId);
  for (const [id, kind] of [
    [input.textModel, 'text'],
    [input.imageModel, 'image'],
  ] as const) {
    if (!id) continue;
    const model = deps.ai.models(keys).find((m) => m.id === id);
    if (!model || model.kind !== kind) throw invalid(`Unknown ${kind} model: ${id}`);
    if (!model.available)
      throw new AppError('ai_unavailable', `${model.label} is not available: its API key is missing.`);
  }
  if (!input.textModel && !deps.ai.defaultModel('text', keys)) {
    throw new AppError('ai_unavailable', 'No text model is available. Add an Anthropic or OpenAI API key.');
  }
  for (const id of [input.contentTemplateId, input.designTemplateId]) {
    if (id) await getTemplate(deps, actor, id);
  }
  if (input.delivery.mode === 'publish') validateSchedule(input.delivery);
}

// Fails fast, before queueing, when the owners' platform budget is used up.
async function assertBudgetFor(deps: CoreDeps, orgId: string, input: GenerationInput): Promise<void> {
  const keys = await orgKeys(deps, orgId);
  await assertPlatformBudget(deps, orgId, keys, plannedModels(deps, keys, input));
}

function validateSchedule(options: { status: string; scheduledAt?: string }): void {
  if (options.status !== 'future') return;
  if (!options.scheduledAt) throw invalid('Choose a date to schedule the post.');
  if (Number.isNaN(Date.parse(options.scheduledAt))) throw invalid('The schedule date is invalid.');
  if (Date.parse(options.scheduledAt) < Date.now()) throw invalid('The schedule date must be in the future.');
}

async function optionalTemplate(deps: CoreDeps, actor: Actor, id: string | undefined): Promise<TemplateView | null> {
  return id ? getTemplate(deps, actor, id) : null;
}

async function requireGeneration(scope: OrgScope, id: string): Promise<Generation> {
  if (!isUuid(id)) throw notFound('Article');
  const generation = await scope.generations.get(id);
  if (!generation) throw notFound('Article');
  return generation;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
