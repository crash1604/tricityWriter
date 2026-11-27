import { randomUUID } from 'node:crypto';
import { AiService, type ImageProvider, type TextProvider } from '@tricity/ai';
import { createDb, forOrg, generations, member, migrateDatabase, organization, system, user } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAiKey } from './ai-keys';
import { addAutoblogTopics, runAutoblog, saveAutoblog, triggerAutoblogRun } from './autoblog';
import type { CoreDeps } from './deps';
import { fakeArticle } from './generation/fake';
import { createGeneration, getGeneration, runGeneration } from './generation/pipeline';
import { assertPlatformBudget, platformAllowance } from './limits';
import { pairSite } from './sites';
import { fakeWordPress, recordingJobs, testDeps } from './testing';
import { usageSummary } from './usage';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;

// Real (non-fake) AiService with platform keys and stub providers, so calls are priced and owned.
const text: TextProvider = {
  async verifyKey() {},
  async generateText(_model, _credential, request) {
    return {
      text: fakeArticle(request),
      servedBy: 'claude-opus-5-5',
      usage: { inputTokens: 2000, outputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0 },
    };
  },
};
const images: ImageProvider = {
  async generateImage() {
    // 1×1 transparent PNG; sharp turns it into WebP.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    return { data: png, mimeType: 'image/png' };
  },
};
const ai = new AiService({
  platformKeys: { anthropic: 'platform-anthropic', openai: 'platform-openai' },
  textProviders: { anthropic: text, openai: text },
  imageProviders: { openai: images },
});

describe.skipIf(!url)('limits (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const wp = fakeWordPress();
  wp.codes.add('GOOD-CODE-0002');
  const { jobs } = recordingJobs();
  const base = testDeps({ db, jobs, fetch: wp.fetch, ai });
  const actor = { orgId: `org_${randomUUID()}`, userId: `user_${randomUUID()}`, role: 'owner' as const };
  const byok = { orgId: `org_${randomUUID()}`, userId: `user_${randomUUID()}`, role: 'owner' as const };
  let siteId = '';
  let byokSiteId = '';

  async function spend(orgId: string, usd: number) {
    await forOrg(db, orgId).usage.record({
      kind: 'text',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      credentialOwner: 'platform',
      inputTokens: 0,
      outputTokens: 0,
      images: 0,
      costMicroUsd: Math.round(usd * 1_000_000),
    });
  }

  beforeAll(async () => {
    await migrateDatabase(url ?? '');
    for (const a of [actor, byok]) {
      await db.insert(user).values({ id: a.userId, name: 'Test', email: `${a.userId}@example.test` });
      await db.insert(organization).values({ id: a.orgId, name: 'Test', slug: a.orgId, createdAt: new Date() });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: a.orgId, userId: a.userId, role: 'owner', createdAt: new Date() });
    }
    siteId = (await pairSite(base, actor, { url: 'https://blog.example.com', code: 'GOOD-CODE-0001' })).id;
    byokSiteId = (await pairSite(base, byok, { url: 'https://blog.example.com', code: 'GOOD-CODE-0002' })).id;
  });
  afterAll(() => close());

  it('records what platform keys cost and reports the allowance', async () => {
    const deps: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 5 } };
    const generation = await createGeneration(deps, actor, { siteId, topic: 'Metered article' }, 'wizard');
    await runGeneration(deps, { orgId: actor.orgId, generationId: generation.id });
    expect((await getGeneration(deps, actor, generation.id)).status).toBe('ready');

    const usage = await usageSummary(deps, actor);
    // Opus 5.5: 2000 × $4 + 3000 × $20 per million tokens = $0.068; plus one GPT Image 2 image at $0.041.
    expect(usage.platform.budgetUsd).toBe(5);
    expect(usage.platform.usedUsd).toBeCloseTo(0.109, 6);
  });

  it('refuses new articles on platform keys once the monthly budget is used', async () => {
    await spend(actor.orgId, 5);
    const deps: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 5 } };
    await expect(createGeneration(deps, actor, { siteId, topic: 'Over budget' }, 'wizard')).rejects.toMatchObject({
      code: 'quota_exceeded',
      status: 402,
    });
    // Without a cap configured, nothing is refused.
    await expect(createGeneration(base, actor, { siteId, topic: 'No cap' }, 'wizard')).resolves.toMatchObject({
      status: 'queued',
    });
  });

  it("doesn't reset the budget for a new workspace with the same owner", async () => {
    const second = `org_${randomUUID()}`;
    await db.insert(organization).values({ id: second, name: 'Second', slug: second, createdAt: new Date() });
    await db
      .insert(member)
      .values({ id: randomUUID(), organizationId: second, userId: actor.userId, role: 'owner', createdAt: new Date() });

    const deps: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 5 } };
    const first = await platformAllowance(deps, actor.orgId);
    expect((await platformAllowance(deps, second)).usedUsd).toBeCloseTo(first.usedUsd, 6);
    await expect(assertPlatformBudget(deps, second, {}, ['claude-opus-5-5'])).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });

  it('fails an already-queued article when it starts over budget', async () => {
    const queued = await createGeneration(base, actor, { siteId, topic: 'Queued before the cap' }, 'wizard');
    const capped: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 1 } };
    await runGeneration(capped, { orgId: actor.orgId, generationId: queued.id });
    const after = await getGeneration(capped, actor, queued.id);
    expect(after.status).toBe('failed');
    expect(after.error).toContain('included AI usage');
  });

  it("never caps a workspace's own keys", async () => {
    await spend(byok.orgId, 50);
    const deps: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 1 } };
    await expect(
      createGeneration(deps, byok, { siteId: byokSiteId, topic: 'Blocked' }, 'wizard'),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });

    await setAiKey(deps, byok, 'anthropic', 'sk-ant-own-key-0000000000000000');
    await setAiKey(deps, byok, 'openai', 'sk-own-openai-key-000000000000000');
    const generation = await createGeneration(deps, byok, { siteId: byokSiteId, topic: 'Own keys' }, 'wizard');
    await runGeneration(deps, { orgId: byok.orgId, generationId: generation.id });
    expect((await getGeneration(deps, byok, generation.id)).status).toBe('ready');
  });

  it('limits how many articles a workspace can have in progress, even under concurrent requests', async () => {
    const active = await forOrg(db, byok.orgId).generations.countActive();
    const capped: CoreDeps = { ...base, limits: { maxActiveGenerations: active + 2 } };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        createGeneration(capped, byok, { siteId: byokSiteId, topic: `Parallel article ${i}` }, 'wizard'),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'too_many', status: 429 });
    }
    expect(await forOrg(db, byok.orgId).generations.countActive()).toBe(active + 2);
  });

  it('skips auto-blogging runs over budget without using up a topic', async () => {
    const deps: CoreDeps = { ...base, limits: { platformMonthlyBudgetUsd: 1 } };
    await saveAutoblog(deps, actor, siteId, {
      enabled: true,
      mode: 'assist',
      threshold: 70,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      settings: { words: 800 },
    });
    await addAutoblogTopics(deps, actor, siteId, [{ topic: 'Waits for next month' }]);

    await expect(triggerAutoblogRun(deps, actor, siteId)).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await runAutoblog(deps, { orgId: actor.orgId, siteId, manual: false })).toEqual({
      skipped: 'over_budget',
    });
    const queued = await forOrg(db, actor.orgId).autoblog.listTopics(siteId, 'queued');
    expect(queued.map((t) => t.topic)).toContain('Waits for next month');
  });

  it('recovers articles whose worker died', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    const ancient = new Date(Date.now() - 8 * 60 * 60_000);
    const input = { siteId, topic: 'Interrupted' };
    const rows = await db
      .insert(generations)
      .values([
        { orgId: actor.orgId, siteId, source: 'wizard', status: 'generating', topic: 'g', input, updatedAt: old },
        {
          orgId: actor.orgId,
          siteId,
          source: 'wizard',
          status: 'publishing',
          topic: 'p',
          input,
          output: {},
          updatedAt: old,
        },
        { orgId: actor.orgId, siteId, source: 'wizard', status: 'queued', topic: 'q', input, updatedAt: ancient },
        { orgId: actor.orgId, siteId, source: 'wizard', status: 'queued', topic: 'fresh', input, updatedAt: old },
      ])
      .returning({ id: generations.id });

    const result = await system.recoverStaleGenerations(db, {
      processing: new Date(Date.now() - 45 * 60_000),
      queued: new Date(Date.now() - 6 * 60 * 60_000),
    });
    expect(result.failed).toBeGreaterThanOrEqual(2);
    expect(result.publishingReset).toBeGreaterThanOrEqual(1);

    const statuses = await Promise.all(
      rows.map(async (r) => (await db.select().from(generations).where(eq(generations.id, r.id)))[0]?.status),
    );
    expect(statuses).toEqual(['failed', 'ready', 'failed', 'queued']);
  });
});
