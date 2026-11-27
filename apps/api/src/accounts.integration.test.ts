import { randomUUID } from 'node:crypto';
import { createMcpKey, deleteWorkspaceData, forgetUser, verifyMcpKey } from '@tricity/core';
import { fakeWordPress, recordingJobs, testDeps } from '@tricity/core/testing';
import { createDb, forOrg, migrateDatabase, organization } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createAuth } from './auth';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery';

describe.skipIf(!url)('deleting workspaces and accounts (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const wp = fakeWordPress();
  const { jobs, calls } = recordingJobs();
  const deps = testDeps({ db, jobs, fetch: wp.fetch });
  const mailer = { delivers: false, send: async () => {} };
  const auth = createAuth({
    db,
    secret: 'x'.repeat(40),
    baseURL: ORIGIN,
    mailer,
    onDeleteWorkspace: (orgId) => deleteWorkspaceData(deps, orgId),
    onDeleteUser: (userId) => forgetUser(deps, userId),
  });
  const app = buildApp({ deps, auth, mailer, origin: ORIGIN });
  const headers = (cookie: string) => ({ cookie, origin: ORIGIN, 'content-type': 'application/json' });

  async function signUp(): Promise<{ cookie: string; email: string }> {
    const email = `del-${randomUUID()}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: PASSWORD, name: 'Deleter' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; '), email };
  }
  async function me(cookie: string) {
    return (await app.inject({ method: 'GET', url: '/api/v1/me', headers: headers(cookie) })).json();
  }
  const auths = (cookie: string, path: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/auth${path}`, headers: headers(cookie), payload });

  beforeAll(() => migrateDatabase(url ?? ''));
  afterAll(async () => {
    await app.close();
    await close();
  });

  it('deletes a workspace with its sites, articles and keys, and disconnects its sites', async () => {
    const { cookie } = await signUp();
    const first = (await me(cookie)).organizationId as string;
    wp.codes.add('DELETE-ME-0001');
    const pair = await app.inject({
      method: 'POST',
      url: '/api/v1/sites/pair',
      headers: headers(cookie),
      payload: { url: 'https://blog.example.com', code: 'DELETE-ME-0001' },
    });
    expect(pair.statusCode, pair.body).toBe(201);
    const siteId = pair.json().site.id;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/sites/${siteId}/autoblog`,
      headers: headers(cookie),
      payload: { enabled: true, mode: 'assist', threshold: 70, schedule: '0 9 * * *', timezone: 'UTC', settings: {} },
    });

    // The only workspace can't go: the account would be left without one.
    const refused = await auths(cookie, '/organization/delete', { organizationId: first });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe('LAST_WORKSPACE');

    const second = await auths(cookie, '/organization/create', { name: 'Second', slug: `second-${randomUUID()}` });
    expect(second.statusCode, second.body).toBe(200);

    const disconnectsBefore = wp.requests.filter((r) => r.route.endsWith('/disconnect')).length;
    const deleted = await auths(cookie, '/organization/delete', { organizationId: first });
    expect(deleted.statusCode, deleted.body).toBe(200);

    expect(await forOrg(db, first).sites.list()).toEqual([]);
    expect(wp.requests.filter((r) => r.route.endsWith('/disconnect')).length).toBe(disconnectsBefore + 1);
    expect(calls).toContainEqual({
      kind: 'scheduleAutoblog',
      job: expect.objectContaining({ orgId: first, siteId, enabled: false }),
    });
    // The session moves on to the remaining workspace.
    expect((await me(cookie)).organizationId).toBe(second.json().id);
  });

  it('keeps shared workspaces owned, and deletes solo ones with the account', async () => {
    const owner = await signUp();
    const teammate = await signUp();
    const shared = (await me(owner.cookie)).organizationId as string;
    const teammateSolo = (await me(teammate.cookie)).organizationId as string;
    const ownerUserId = (await me(owner.cookie)).user.id as string;

    const invite = await auths(owner.cookie, '/organization/invite-member', {
      email: teammate.email,
      role: 'member',
      organizationId: shared,
    });
    expect(invite.statusCode, invite.body).toBe(200);
    expect(
      (await auths(teammate.cookie, '/organization/accept-invitation', { invitationId: invite.json().id })).statusCode,
    ).toBe(200);
    const { key } = await createMcpKey(deps, { orgId: shared, userId: ownerUserId, role: 'owner' }, 'laptop');

    const blocked = await auths(owner.cookie, '/delete-user', { password: PASSWORD });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('SOLE_OWNER');

    const full = await app.inject({
      method: 'GET',
      url: `/api/auth/organization/get-full-organization?organizationId=${shared}`,
      headers: headers(owner.cookie),
    });
    const teammateMember = full
      .json()
      .members.find((m: { user: { email: string } }) => m.user.email === teammate.email);
    const promote = await auths(owner.cookie, '/organization/update-member-role', {
      memberId: teammateMember.id,
      role: 'owner',
      organizationId: shared,
    });
    expect(promote.statusCode, promote.body).toBe(200);

    const gone = await auths(owner.cookie, '/delete-user', { password: PASSWORD });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await db.query.organization.findFirst({ where: eq(organization.id, shared) })).toBeDefined();
    expect(await verifyMcpKey(deps, key)).toBeNull();

    const wrongPassword = await auths(teammate.cookie, '/delete-user', { password: 'not the password' });
    expect(wrongPassword.statusCode).toBe(400);

    // The teammate is now alone in both workspaces, so both go with their account.
    const last = await auths(teammate.cookie, '/delete-user', { password: PASSWORD });
    expect(last.statusCode, last.body).toBe(200);
    for (const id of [shared, teammateSolo]) {
      expect(await db.query.organization.findFirst({ where: eq(organization.id, id) })).toBeUndefined();
    }
  });

  it('moves members of a deleted workspace on to another one, or a new one of their own', async () => {
    const owner = await signUp();
    const member = await signUp();
    const memberOwn = (await me(member.cookie)).organizationId as string;
    const second = await auths(owner.cookie, '/organization/create', { name: 'Team', slug: `team-${randomUUID()}` });
    const team = second.json().id as string;

    const invite = await auths(owner.cookie, '/organization/invite-member', {
      email: member.email,
      role: 'member',
      organizationId: team,
    });
    await auths(member.cookie, '/organization/accept-invitation', { invitationId: invite.json().id });
    await auths(member.cookie, '/organization/set-active', { organizationId: team });
    // The member deletes their own workspace, so the team is the only one they have.
    expect((await auths(member.cookie, '/organization/delete', { organizationId: memberOwn })).statusCode).toBe(200);
    await auths(member.cookie, '/organization/set-active', { organizationId: team });
    expect((await me(member.cookie)).organizationId).toBe(team);

    expect((await auths(owner.cookie, '/organization/delete', { organizationId: team })).statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: headers(member.cookie) });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().organizationId).not.toBe(team);
    expect(after.json().organizations).toHaveLength(1);
  });
});
