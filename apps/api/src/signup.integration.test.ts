import { randomUUID } from 'node:crypto';
import { recordingJobs, testDeps } from '@tricity/core/testing';
import { createDb, migrateDatabase } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createAuth, INVITATION_HEADER, type SignupMode } from './auth';
import type { Email, Mailer } from './mailer';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:3000';
const json = { origin: ORIGIN, 'content-type': 'application/json' };

describe.skipIf(!url)('sign-up policy (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const deps = testDeps({ db, jobs: recordingJobs().jobs });
  const sent: Email[] = [];
  const mailer: Mailer = { delivers: true, send: async (email) => void sent.push(email) };

  function appWith(signupMode: SignupMode, requireEmailVerification: boolean): FastifyInstance {
    const auth = createAuth({
      db,
      secret: 'x'.repeat(40),
      baseURL: ORIGIN,
      mailer,
      signupMode,
      requireEmailVerification,
    });
    return buildApp({ deps, auth, mailer, origin: ORIGIN, signup: { mode: signupMode, emailVerification: true } });
  }
  const open = appWith('open', false);
  const inviteOnly = appWith('invite', false);
  const verifying = appWith('open', true);

  const cookiesOf = (res: { cookies: { name: string; value: string }[] }) =>
    res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const signUp = (app: FastifyInstance, email: string, invitationId?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: invitationId ? { ...json, [INVITATION_HEADER]: invitationId } : json,
      payload: { email, password: 'correct horse battery', name: 'Someone', callbackURL: '/verify-email' },
    });

  beforeAll(() => migrateDatabase(url ?? ''));
  afterAll(async () => {
    await Promise.all([open.close(), inviteOnly.close(), verifying.close()]);
    await close();
  });

  it('tells the sign-up page how accounts are created', async () => {
    const res = await inviteOnly.inject({ method: 'GET', url: '/api/public/config' });
    expect(res.json()).toEqual({ signupMode: 'invite', emailVerification: true, passwordResetByEmail: true });
  });

  it('reports database health', async () => {
    const res = await open.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, version: '1.0.0' });
  });

  it('accepts only invited people when sign-ups are invite-only', async () => {
    // Accounts already exist in this database, so the first-account exception doesn't apply.
    const owner = cookiesOf(await signUp(open, `owner-${randomUUID()}@example.com`));
    const me = (
      await open.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: owner, origin: ORIGIN } })
    ).json();

    const stranger = await signUp(inviteOnly, `stranger-${randomUUID()}@example.com`);
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().message).toContain('by invitation only');

    const inviteeEmail = `Invitee-${randomUUID()}@Example.com`;
    const invite = await inviteOnly.inject({
      method: 'POST',
      url: '/api/auth/organization/invite-member',
      headers: { ...json, cookie: owner },
      payload: { email: inviteeEmail, role: 'member', organizationId: me.organizationId },
    });
    expect(invite.statusCode, invite.body).toBe(200);

    // Knowing the invitee's address isn't enough: the invitation's id (from its link) is the secret.
    const guessed = await signUp(inviteOnly, inviteeEmail.toLowerCase());
    expect(guessed.statusCode).toBe(403);
    const wrongId = await signUp(inviteOnly, inviteeEmail.toLowerCase(), randomUUID());
    expect(wrongId.statusCode).toBe(403);

    const invitee = await signUp(inviteOnly, inviteeEmail.toLowerCase(), invite.json().id);
    expect(invitee.statusCode, invitee.body).toBe(200);
  });

  it("doesn't list invitations by email address", async () => {
    const cookie = cookiesOf(await signUp(open, `lister-${randomUUID()}@example.com`));
    const res = await open.inject({
      method: 'GET',
      url: '/api/auth/organization/list-user-invitations',
      headers: { cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires a confirmed email before signing in when emails are delivered', async () => {
    const email = `verify-${randomUUID()}@example.com`;
    const created = await signUp(verifying, email);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().token).toBeNull();
    expect(cookiesOf(created)).not.toContain('session_token');
    expect(sent.filter((m) => m.to === email)).toHaveLength(1);

    const early = await verifying.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: json,
      payload: { email, password: 'correct horse battery', callbackURL: '/verify-email' },
    });
    expect(early.statusCode).toBe(403);
    expect(early.json().code).toBe('EMAIL_NOT_VERIFIED');
    // The failed sign-in sent a fresh link.
    const links = sent.filter((m) => m.to === email).map((m) => m.text.match(/https?:\/\/\S+/)?.[0] ?? '');
    expect(links).toHaveLength(2);

    const link = new URL(links[1] ?? '');
    expect(link.pathname).toBe('/api/auth/verify-email');
    const confirmed = await verifying.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    expect(confirmed.statusCode).toBe(302);
    expect(confirmed.headers.location).toBe('/verify-email');
    const session = cookiesOf(confirmed);
    expect(session).toContain('session_token');

    const me = await verifying.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: session, origin: ORIGIN },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().user.email).toBe(email);
  });
});
