import { randomUUID } from 'node:crypto';
import { publishGeneration, runGeneration } from '@tricity/core';
import { fakeWordPress, recordingJobs, testDeps } from '@tricity/core/testing';
import { createDb, migrateDatabase } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createAuth } from './auth';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:3000';

describe.skipIf(!url)('api (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const wp = fakeWordPress();
  const { jobs, calls } = recordingJobs();
  const deps = testDeps({ db, jobs, fetch: wp.fetch });
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer = { delivers: false, send: async (email: (typeof sent)[number]) => void sent.push(email) };
  const auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN, mailer });
  const app = buildApp({ deps, auth, mailer, origin: ORIGIN });

  async function signUp(): Promise<string> {
    const email = `user-${randomUUID()}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'correct horse battery', name: 'Test User' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cookies = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect(cookies).toContain('session_token');
    return cookies;
  }

  const as = (cookie: string) => ({ cookie, origin: ORIGIN });
  let alice = '';
  let bob = '';
  let siteId = '';

  beforeAll(async () => {
    await migrateDatabase(url ?? '');
    alice = await signUp();
    bob = await signUp();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  it('requires a session for /api/v1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sites' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
  });

  it('gives every new user a workspace', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as(alice) });
    expect(res.statusCode, res.body).toBe(200);
    const me = res.json();
    expect(me.user.name).toBe('Test User');
    expect(me.organizations).toHaveLength(1);
    expect(me.organizationId).toBe(me.organizations[0].id);
  });

  it('pairs a site and keeps it private to the workspace', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/sites/pair',
      headers: as(alice),
      payload: { url: 'https://blog.example.com', code: 'NOPE-NOPE' },
    });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sites/pair',
      headers: as(alice),
      payload: { url: 'https://blog.example.com', code: 'GOOD-CODE-0001' },
    });
    expect(res.statusCode, res.body).toBe(201);
    siteId = res.json().site.id;
    expect(res.json().site.tokenCiphertext).toBeUndefined();

    const bobSees = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}`, headers: as(bob) });
    expect(bobSees.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/sites', headers: as(bob) })).json().sites).toEqual([]);
  });

  it('runs the wizard flow: generate, preview, edit, publish', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/generations',
      headers: as(alice),
      payload: { siteId, topic: 'Indoor herb garden', keywords: 'indoor herb garden', words: 500, inlineImages: 1 },
    });
    expect(created.statusCode, created.body).toBe(202);
    const id = created.json().generation.id;
    const job = calls.at(-1)?.job as { orgId: string; generationId: string };
    expect(job.generationId).toBe(id);

    await runGeneration(deps, job);
    const ready = (await app.inject({ method: 'GET', url: `/api/v1/generations/${id}`, headers: as(alice) })).json()
      .generation;
    expect(ready.status, ready.error).toBe('ready');
    expect(ready.output.previewHtml).toContain(`/api/v1/generations/${id}/images/1?v=`);
    expect(ready.output.featuredImageUrl).toContain(`/images/0`);

    const image = await app.inject({ method: 'GET', url: `/api/v1/generations/${id}/images/1`, headers: as(alice) });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/generations/${id}/images/1`, headers: as(bob) })).statusCode,
    ).toBe(404);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/generations/${id}`,
      headers: as(alice),
      payload: { title: 'My herb garden' },
    });
    expect(edited.json().generation.output.title).toBe('My herb garden');

    const badSchedule = await app.inject({
      method: 'POST',
      url: `/api/v1/generations/${id}/publish`,
      headers: as(alice),
      payload: { status: 'future' },
    });
    expect(badSchedule.statusCode).toBe(400);

    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/generations/${id}/publish`,
      headers: as(alice),
      payload: { status: 'publish' },
    });
    expect(publish.statusCode, publish.body).toBe(202);
    await publishGeneration(deps, calls.at(-1)?.job as Parameters<typeof publishGeneration>[1]);

    const done = (await app.inject({ method: 'GET', url: `/api/v1/generations/${id}`, headers: as(alice) })).json()
      .generation;
    expect(done.status, done.error).toBe('published');
    expect(wp.posts.get(done.wpPostId)?.title).toBe('My herb garden');

    const list = (
      await app.inject({ method: 'GET', url: `/api/v1/generations?siteId=${siteId}`, headers: as(alice) })
    ).json();
    expect(list.generations[0]).toMatchObject({ id, title: 'My herb garden', status: 'published' });
    expect(list.generations[0].output).toBeUndefined();
  });

  it('manages templates and auto-blogging', async () => {
    const tpl = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: as(alice),
      payload: { kind: 'design', name: 'Brand', prompt: 'Use green accents and a closing call to action.' },
    });
    expect(tpl.statusCode, tpl.body).toBe(201);
    const templates = (
      await app.inject({ method: 'GET', url: '/api/v1/templates?kind=design', headers: as(alice) })
    ).json();
    expect(templates.templates.map((t: { name: string }) => t.name)).toContain('Brand');
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/templates', headers: as(bob) })).json().templates,
    ).not.toContainEqual(expect.objectContaining({ name: 'Brand' }));

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/sites/${siteId}/autoblog`,
      headers: as(alice),
      payload: {
        enabled: true,
        mode: 'assist',
        threshold: 70,
        schedule: '0 7 * * *',
        timezone: 'America/New_York',
        settings: { designTemplateId: tpl.json().template.id },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const topics = await app.inject({
      method: 'POST',
      url: `/api/v1/sites/${siteId}/autoblog/topics`,
      headers: as(alice),
      payload: { topics: ['Basil care', { topic: 'Mint varieties', keywords: 'mint' }] },
    });
    expect(topics.statusCode).toBe(201);
    const run = await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/autoblog/run`, headers: as(alice) });
    expect(run.statusCode).toBe(202);
    expect(calls.at(-1)).toMatchObject({ kind: 'autoblogRun', job: { siteId, manual: true } });
  });

  it('resets a forgotten password through the emailed link', async () => {
    const email = `reset-${randomUUID()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'original password', name: 'Reset Me' },
    });
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, redirectTo: `${ORIGIN}/reset-password` },
    });
    expect(request.statusCode, request.body).toBe(200);
    const mail = sent.find((m) => m.to === email);
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(link).toContain('/reset-password');

    // The emailed link redirects to the dashboard page with the token.
    const follow = await app.inject({ method: 'GET', url: new URL(link).pathname + new URL(link).search });
    const token = new URL(String(follow.headers.location), ORIGIN).searchParams.get('token') ?? '';
    expect(token).not.toBe('');

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { newPassword: 'brand new password', token },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'brand new password' },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('invites teammates by link and limits members to content work', async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: as(alice) })).json();
    expect(me.role).toBe('owner');

    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const invite = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/invite-member',
      headers: { ...as(alice), 'content-type': 'application/json' },
      payload: { email: inviteeEmail, role: 'member', organizationId: me.organizationId },
    });
    expect(invite.statusCode, invite.body).toBe(200);
    const invitationId = invite.json().id;
    expect(sent.find((m) => m.to === inviteeEmail)?.text).toContain(`/accept-invite/${invitationId}`);

    const signUpRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: inviteeEmail, password: 'correct horse battery', name: 'Invitee' },
    });
    const invitee = signUpRes.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const accept = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/accept-invitation',
      headers: { ...as(invitee), 'content-type': 'application/json' },
      payload: { invitationId },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/auth/organization/set-active',
      headers: { ...as(invitee), 'content-type': 'application/json' },
      payload: { organizationId: me.organizationId },
    });

    const inviteeMe = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: as(invitee) })).json();
    expect(inviteeMe).toMatchObject({ organizationId: me.organizationId, role: 'member' });
    expect(inviteeMe.organizations).toHaveLength(2);

    // Members see the workspace's sites but cannot change workspace-wide settings.
    const sites = (await app.inject({ method: 'GET', url: '/api/v1/sites', headers: as(invitee) })).json().sites;
    expect(sites.map((s: { id: string }) => s.id)).toContain(siteId);
    const setKey = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai-keys/anthropic',
      headers: as(invitee),
      payload: { apiKey: 'sk-ant-0123456789abcdefghij' },
    });
    expect(setKey.statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/sites/${siteId}`, headers: as(invitee) })).statusCode,
    ).toBe(403);

    const ownerKey = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai-keys/anthropic',
      headers: as(alice),
      payload: { apiKey: 'sk-ant-0123456789abcdefghij' },
    });
    expect(ownerKey.statusCode, ownerKey.body).toBe(200);
    const models = (await app.inject({ method: 'GET', url: '/api/v1/models', headers: as(invitee) })).json();
    expect(models.ownKeys).toEqual(['anthropic']);
  });

  it('serves MCP tools to holders of a key', async () => {
    const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(unauthorized.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp-keys',
      headers: as(alice),
      payload: { name: 'Claude' },
    });
    const key = created.json().key as string;
    const headers = { ...mcpHeaders, authorization: `Bearer ${key}` };

    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      },
    });
    expect(init.statusCode, init.body).toBe(200);
    expect(init.json().result.serverInfo.name).toBe('tricity-writer');

    const tools = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    const names = tools.json().result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['create_post', 'generate_article', 'set_post_seo', 'autoblog_add_topics']),
    );

    const call = async (name: string, args: Record<string, unknown>) =>
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers,
          payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
        })
      ).json().result;

    const sites = await call('list_sites', {});
    expect(JSON.parse(sites.content[0].text)[0].id).toBe(siteId);

    const post = await call('create_post', {
      site_id: siteId,
      title: 'From Claude',
      content_html: '<p>Hello</p><script>alert(1)</script>',
      categories: ['Notes'],
    });
    expect(post.isError).toBeFalsy();
    const created_post = JSON.parse(post.content[0].text);
    expect(wp.posts.get(created_post.id)?.content).toBe('<p>Hello</p>');

    const missing = await call('get_post', { site_id: randomUUID(), post_id: 1 });
    expect(missing).toMatchObject({ isError: true, content: [{ text: 'Site not found.' }] });

    const article = await call('generate_article', { site_id: siteId, topic: 'Window boxes', deliver: 'review' });
    expect(JSON.parse(article.content[0].text).status).toBe('queued');

    // Bob's workspace cannot use Alice's site through MCP either.
    const bobKey = (
      await app.inject({ method: 'POST', url: '/api/v1/mcp-keys', headers: as(bob), payload: { name: 'Bob' } })
    ).json().key;
    const bobCall = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...mcpHeaders, authorization: `Bearer ${bobKey}` },
      payload: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_post', arguments: { site_id: siteId, post_id: 1 } },
      },
    });
    expect(bobCall.json().result).toMatchObject({ isError: true });
  });
});
