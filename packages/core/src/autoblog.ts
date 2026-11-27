import { forOrg } from '@tricity/db';
import type { AutoblogRunJob } from '@tricity/shared';
import { z } from 'zod';
import { orgKeys } from './ai-keys';
import type { Actor, CoreDeps } from './deps';
import { AppError, invalid, notFound } from './errors';
import { runGeneration } from './generation/pipeline';
import { generationInputSchema, generationOptionsSchema } from './generation/types';
import { isUuid } from './ids';
import { assertPlatformBudget, plannedModels } from './limits';
import { getSite } from './sites';
import { getTemplate } from './templates';

// Auto-blogging runs the same generation pipeline as the wizard, on a schedule, using the next
// topic from the site's queue. It never invents topics.

const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;

export const autoblogProfileSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['assist', 'guarded', 'autopilot']),
  threshold: z.number().int().min(0).max(100),
  schedule: z
    .string()
    .trim()
    .refine((s) => s.split(/\s+/).length === 5 && s.split(/\s+/).every((f) => CRON_FIELD.test(f)), {
      message: 'Schedule must be a 5-field cron pattern, e.g. "0 9 * * 1-5".',
    }),
  timezone: z.string().refine(isTimeZone, { message: 'Unknown time zone.' }),
  settings: generationOptionsSchema,
});
export type AutoblogProfileInput = z.input<typeof autoblogProfileSchema>;
export type AutoblogProfileView = z.infer<typeof autoblogProfileSchema>;

const DEFAULT_PROFILE: AutoblogProfileView = {
  enabled: false,
  mode: 'assist',
  threshold: 70,
  schedule: '0 9 * * *',
  timezone: 'UTC',
  settings: generationOptionsSchema.parse({}),
};

export async function getAutoblog(deps: CoreDeps, actor: Actor, siteId: string) {
  await getSite(deps, actor, siteId);
  const scope = forOrg(deps.db, actor.orgId);
  const profile = await scope.autoblog.getProfile(siteId);
  return {
    profile: profile
      ? {
          enabled: profile.enabled,
          mode: profile.mode,
          threshold: profile.threshold,
          schedule: profile.schedule,
          timezone: profile.timezone,
          settings: generationOptionsSchema.parse(profile.settings),
        }
      : DEFAULT_PROFILE,
    queue: await scope.autoblog.listTopics(siteId, 'queued'),
    history: await scope.generations.list({ siteId, source: 'autoblog', limit: 20 }),
  };
}

export async function saveAutoblog(deps: CoreDeps, actor: Actor, siteId: string, input: AutoblogProfileInput) {
  const parsed = autoblogProfileSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues.map((i) => i.message).join(' '));
  const profile = parsed.data;
  await getSite(deps, actor, siteId);
  for (const id of [profile.settings.contentTemplateId, profile.settings.designTemplateId]) {
    if (id) await getTemplate(deps, actor, id);
  }

  await forOrg(deps.db, actor.orgId).autoblog.upsertProfile(siteId, profile);
  await deps.jobs.scheduleAutoblog({
    orgId: actor.orgId,
    siteId,
    enabled: profile.enabled,
    schedule: profile.schedule,
    timezone: profile.timezone,
  });
  return getAutoblog(deps, actor, siteId);
}

export async function addAutoblogTopics(
  deps: CoreDeps,
  actor: Actor,
  siteId: string,
  topics: { topic: string; keywords?: string }[],
) {
  await getSite(deps, actor, siteId);
  const seen = new Set<string>();
  const clean = topics
    .map((t) => ({ topic: t.topic.trim().slice(0, 300), keywords: t.keywords?.trim().slice(0, 500) ?? '' }))
    .filter((t) => {
      const key = t.topic.toLowerCase();
      if (t.topic.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (clean.length === 0) throw invalid('Add at least one topic (3+ characters).');
  if (clean.length > 200) throw invalid('Add at most 200 topics at a time.');
  return forOrg(deps.db, actor.orgId).autoblog.addTopics(siteId, clean);
}

export async function removeAutoblogTopic(deps: CoreDeps, actor: Actor, topicId: string): Promise<void> {
  if (!isUuid(topicId) || !(await forOrg(deps.db, actor.orgId).autoblog.removeTopic(topicId))) {
    throw notFound('Queued topic');
  }
}

export async function triggerAutoblogRun(deps: CoreDeps, actor: Actor, siteId: string): Promise<void> {
  await getSite(deps, actor, siteId);
  const scope = forOrg(deps.db, actor.orgId);
  const profile = await scope.autoblog.getProfile(siteId);
  if (!profile) throw invalid('Save the auto-blogging settings first.');
  if ((await scope.autoblog.countQueued(siteId)) === 0) throw invalid('The topic queue is empty.');
  await assertAutoblogBudget(deps, actor.orgId, profile.settings);
  await deps.jobs.autoblogRun({ orgId: actor.orgId, siteId, manual: true });
}

export type AutoblogRunResult =
  | { generationId: string }
  | { skipped: 'no_profile' | 'disabled' | 'no_topics' | 'over_budget' };

// Over budget, a run would claim a topic only to fail it; leave the queue untouched instead.
async function assertAutoblogBudget(deps: CoreDeps, orgId: string, settings: unknown): Promise<void> {
  const keys = await orgKeys(deps, orgId);
  await assertPlatformBudget(
    deps,
    orgId,
    keys,
    plannedModels(deps, keys, generationOptionsSchema.parse(settings ?? {})),
  );
}

// Worker: one auto-blogging run for one site.
export async function runAutoblog(deps: CoreDeps, job: AutoblogRunJob): Promise<AutoblogRunResult> {
  const scope = forOrg(deps.db, job.orgId);
  const profile = await scope.autoblog.getProfile(job.siteId);
  if (!profile) return { skipped: 'no_profile' };
  if (!profile.enabled && !job.manual) return { skipped: 'disabled' };
  try {
    await assertAutoblogBudget(deps, job.orgId, profile.settings);
  } catch (error) {
    if (error instanceof AppError && error.code === 'quota_exceeded') return { skipped: 'over_budget' };
    throw error;
  }

  const topic = await scope.autoblog.claimNextTopic(job.siteId);
  if (!topic) return { skipped: 'no_topics' };

  try {
    const settings = generationOptionsSchema.parse(profile.settings);
    const input = generationInputSchema.parse({
      ...settings,
      siteId: job.siteId,
      topic: topic.topic,
      keywords: topic.keywords,
      delivery: { mode: 'autoblog', policy: profile.mode, threshold: profile.threshold, topicId: topic.id },
    });
    const generation = await scope.generations.create({
      siteId: job.siteId,
      source: 'autoblog',
      status: 'queued',
      topic: topic.topic,
      input,
    });
    await scope.autoblog.updateTopic(topic.id, { generationId: generation.id });

    await runGeneration(deps, { orgId: job.orgId, generationId: generation.id });
    const finished = await scope.generations.get(generation.id);
    if (finished?.status === 'failed') await scope.autoblog.updateTopic(topic.id, { status: 'failed' });
    return { generationId: generation.id };
  } catch (error) {
    await scope.autoblog.updateTopic(topic.id, { status: 'failed' });
    throw error;
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
