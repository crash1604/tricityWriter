import { randomUUID } from 'node:crypto';
import { createDb, forOrg, member, migrateDatabase, organization, user } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { availableModels, listAiKeys, orgKeys, removeAiKey, setAiKey } from './ai-keys';
import { addAutoblogTopics, getAutoblog, runAutoblog, saveAutoblog } from './autoblog';
import type { CoreDeps } from './deps';
import { AppError } from './errors';
import {
  createGeneration,
  editGeneration,
  getGeneration,
  publishGeneration,
  requestPublish,
  runGeneration,
} from './generation/pipeline';
import type { GenerationOutput } from './generation/types';
import { createMcpKey, revokeMcpKey, verifyMcpKey } from './mcp-keys';
import { createPost, listPosts } from './posts';
import { getSite, listSites, pairSite, refreshSite, removeSite } from './sites';
import { createTemplate, listTemplates } from './templates';
import { fakeWordPress, recordingJobs, testDeps } from './testing';
import { usageSummary } from './usage';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('core services (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const wp = fakeWordPress();
  const { jobs, calls } = recordingJobs();
  const deps: CoreDeps = testDeps({ db, jobs, fetch: wp.fetch });
  const actor = { orgId: `org_${randomUUID()}`, userId: `user_${randomUUID()}`, role: 'owner' as const };
  const other = { orgId: `org_${randomUUID()}`, userId: `user_${randomUUID()}`, role: 'owner' as const };
  let siteId = '';

  beforeAll(async () => {
    await migrateDatabase(url ?? '');
    // Better Auth rows the services rely on for membership checks.
    for (const a of [actor, other]) {
      await db.insert(user).values({ id: a.userId, name: 'Test', email: `${a.userId}@example.test` });
      await db.insert(organization).values({ id: a.orgId, name: 'Test', slug: a.orgId, createdAt: new Date() });
      await db
        .insert(member)
        .values({ id: randomUUID(), organizationId: a.orgId, userId: a.userId, role: 'owner', createdAt: new Date() });
    }
  });
  afterAll(() => close());

  it('pairs a site with a code, storing only an encrypted token', async () => {
    await expect(pairSite(deps, actor, { url: 'blog.example.com', code: 'WRONG' })).rejects.toMatchObject({
      code: 'invalid',
    });
    const site = await pairSite(deps, actor, { url: 'https://blog.example.com/', code: 'GOOD-CODE-0001' });
    siteId = site.id;
    expect(site).toMatchObject({
      name: 'Example Blog',
      url: 'https://blog.example.com',
      status: 'connected',
      seoPlugin: 'yoast',
    });
    expect(site).not.toHaveProperty('tokenCiphertext');

    const stored = await getSite(deps, actor, site.id);
    expect(stored.tokenCiphertext).toMatch(/^v1\./);
    expect(stored.tokenCiphertext).not.toContain('tcw_');
  });

  it('re-pairing the same address updates the existing site', async () => {
    wp.codes.add('GOOD-CODE-0002');
    const again = await pairSite(deps, actor, { url: 'https://BLOG.example.com', code: 'GOOD-CODE-0002' });
    expect(again.id).toBe(siteId);
    expect(await listSites(deps, actor)).toHaveLength(1);
  });

  it('keeps sites private to their organization', async () => {
    expect(await listSites(deps, other)).toEqual([]);
    await expect(getSite(deps, other, siteId)).rejects.toBeInstanceOf(AppError);
    await expect(listPosts(deps, other, siteId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('generates an article for review, then publishes it with images and SEO', async () => {
    const template = await createTemplate(deps, actor, {
      kind: 'content',
      name: 'Recipe',
      prompt: 'Write it as a recipe with ingredients and steps.',
    });
    expect((await listTemplates(deps, actor, 'content')).some((t) => t.id === template.id)).toBe(true);

    const generation = await createGeneration(
      deps,
      actor,
      {
        siteId,
        topic: 'Cold brew coffee at home',
        keywords: 'cold brew coffee',
        words: 600,
        inlineImages: 1,
        contentTemplateId: template.id,
        designTemplateId: 'builtin:visual',
      },
      'wizard',
    );
    expect(generation.status).toBe('queued');
    expect(calls.at(-1)).toEqual({ kind: 'generate', job: { orgId: actor.orgId, generationId: generation.id } });

    await runGeneration(deps, { orgId: actor.orgId, generationId: generation.id });
    const ready = await getGeneration(deps, actor, generation.id);
    expect(ready.status, ready.error ?? '').toBe('ready');
    const output = ready.output as GenerationOutput;
    expect(output.title).toMatch(/cold brew coffee/i);
    expect(output.images.map((i) => i.slot)).toEqual([0, 1]);
    expect(output.html).toContain('tcw-image://1');
    expect(output.seo.score).toBeGreaterThan(60);
    expect(ready.seoScore).toBe(output.seo.score);

    const edited = await editGeneration(deps, actor, generation.id, {
      metaDescription: 'Edited description',
      html: `${output.html}<script>alert(1)</script>`,
    });
    const editedOutput = edited.output as GenerationOutput;
    expect(editedOutput.metaDescription).toBe('Edited description');
    expect(editedOutput.html).not.toContain('<script>');

    await requestPublish(deps, actor, generation.id, { status: 'publish' });
    expect(calls.at(-1)?.kind).toBe('publish');
    await publishGeneration(deps, { orgId: actor.orgId, generationId: generation.id, status: 'publish' });

    const published = await getGeneration(deps, actor, generation.id);
    expect(published.status, published.error ?? '').toBe('published');
    const post = wp.posts.get(published.wpPostId ?? -1);
    expect(post).toBeDefined();
    expect(post?.status).toBe('publish');
    expect(post?.content).toMatch(/<a href="https:\/\/blog\.example\.com\/wp-content\/uploads\/[^"]+-1\.webp"><img /);
    expect(post?.content).not.toContain('tcw-image://');
    expect(post?.featured_media).not.toBeNull();
    expect(post?.seo.description).toBe('Edited description');
    expect(post?.categories).toEqual(['Uncategorized']);
    expect(wp.media.size).toBe(2);

    // Publishing again updates the same post and reuses uploaded media.
    await publishGeneration(deps, { orgId: actor.orgId, generationId: generation.id, status: 'draft' });
    expect(wp.posts.get(published.wpPostId ?? -1)?.status).toBe('draft');
    expect(wp.media.size).toBe(2);
  });

  it('records usage for every AI call', async () => {
    const summary = await usageSummary(deps, actor);
    expect(summary.articles).toBeGreaterThanOrEqual(1);
    expect(summary.byModel.find((r) => r.kind === 'text')?.calls).toBe(1);
    expect(summary.totals.images).toBe(2);
  });

  it('auto-blogs from the topic queue under the guarded policy', async () => {
    await expect(
      saveAutoblog(deps, actor, siteId, {
        enabled: true,
        mode: 'guarded',
        threshold: 101,
        schedule: '0 9 * * *',
        timezone: 'UTC',
        settings: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid' });

    const saved = await saveAutoblog(deps, actor, siteId, {
      enabled: true,
      mode: 'guarded',
      // The fake article cannot reach 100, so guarded mode must hold it as a draft.
      threshold: 100,
      schedule: '30 8 * * 1-5',
      timezone: 'Europe/Berlin',
      settings: { words: 500, featuredImage: false },
    });
    expect(saved.profile.schedule).toBe('30 8 * * 1-5');
    expect(calls.at(-1)).toEqual({
      kind: 'scheduleAutoblog',
      job: { orgId: actor.orgId, siteId, enabled: true, schedule: '30 8 * * 1-5', timezone: 'Europe/Berlin' },
    });

    expect(await runAutoblog(deps, { orgId: actor.orgId, siteId })).toEqual({ skipped: 'no_topics' });
    await addAutoblogTopics(deps, actor, siteId, [{ topic: 'French press basics' }, { topic: 'french press BASICS' }]);
    expect((await getAutoblog(deps, actor, siteId)).queue).toHaveLength(1);

    const result = await runAutoblog(deps, { orgId: actor.orgId, siteId });
    expect(result).toHaveProperty('generationId');
    const run = await getGeneration(deps, actor, (result as { generationId: string }).generationId);
    expect(run.status, run.error ?? '').toBe('published');
    expect(run.wpPostStatus).toBe('draft');
    expect((run.output as GenerationOutput).warnings.join(' ')).toMatch(/below the publishing threshold of 100/);

    const after = await getAutoblog(deps, actor, siteId);
    expect(after.queue).toHaveLength(0);
    expect(after.history[0]?.id).toBe(run.id);
  });

  it('creates posts directly and detects revoked connections', async () => {
    const post = await createPost(deps, actor, siteId, { title: 'Direct', content: '<p>Hi</p>', status: 'draft' });
    expect(post.title).toBe('Direct');

    wp.revokeAll();
    await expect(listPosts(deps, actor, siteId)).rejects.toMatchObject({ code: 'site_disconnected' });
    expect((await getSite(deps, actor, siteId)).status).toBe('disconnected');
    expect((await refreshSite(deps, actor, siteId)).status).toBeNull();
  });

  it('issues MCP keys that resolve to their org and stop working when revoked', async () => {
    const created = await createMcpKey(deps, actor, 'Claude Desktop');
    expect(created.key).toMatch(/^tcw_mcp_/);
    expect(await verifyMcpKey(deps, created.key)).toEqual({ orgId: actor.orgId, userId: actor.userId, role: 'owner' });
    expect(await verifyMcpKey(deps, `${created.key}x`)).toBeNull();

    await expect(revokeMcpKey(deps, other, created.id)).rejects.toMatchObject({ code: 'not_found' });
    await revokeMcpKey(deps, actor, created.id);
    expect(await verifyMcpKey(deps, created.key)).toBeNull();
  });

  it('stores workspace AI keys encrypted and prefers them', async () => {
    await expect(
      setAiKey(deps, { ...actor, role: 'member' }, 'anthropic', 'sk-ant-0123456789abcdef'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setAiKey(deps, actor, 'anthropic', 'short')).rejects.toMatchObject({ code: 'invalid' });

    const saved = await setAiKey(deps, actor, 'anthropic', 'sk-ant-0123456789abcdefWXYZ');
    expect(saved).toMatchObject({ provider: 'anthropic', last4: 'WXYZ' });
    expect(await listAiKeys(deps, actor)).toEqual([expect.objectContaining({ provider: 'anthropic', last4: 'WXYZ' })]);
    expect(await orgKeys(deps, actor.orgId)).toEqual({ anthropic: 'sk-ant-0123456789abcdefWXYZ' });
    expect(await orgKeys(deps, other.orgId)).toEqual({});
    expect((await availableModels(deps, actor)).ownKeys).toEqual(['anthropic']);

    await removeAiKey(deps, actor, 'anthropic');
    expect(await listAiKeys(deps, actor)).toEqual([]);
  });

  it('stops honoring MCP keys of users who left the workspace', async () => {
    const created = await createMcpKey(deps, actor, 'Leaver');
    await db.delete(member).where(eq(member.userId, actor.userId));
    expect(await verifyMcpKey(deps, created.key)).toBeNull();
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: actor.orgId,
      userId: actor.userId,
      role: 'owner',
      createdAt: new Date(),
    });
  });

  it('removes a site and its schedule', async () => {
    await expect(removeSite(deps, { ...actor, role: 'member' }, siteId)).rejects.toMatchObject({ code: 'forbidden' });
    await removeSite(deps, actor, siteId);
    expect(await listSites(deps, actor)).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ kind: 'scheduleAutoblog', job: { siteId, enabled: false } });
    expect(await forOrg(db, actor.orgId).generations.list({ siteId })).toEqual([]);
  });
});
