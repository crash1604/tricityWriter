import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { recordingJobs, testDeps } from '@tricity/core/testing';
import { createDb, member, migrateDatabase } from '@tricity/db';
import { loadRootEnv } from '@tricity/shared/env';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createAuth } from './auth';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:3000';
const REDIRECT = 'http://127.0.0.1:9999/callback';

// MCP sign-in: the OAuth 2.1 flow an MCP client (Claude, ChatGPT, Cursor…) runs against us.
describe.skipIf(!url)('MCP OAuth (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const deps = testDeps({ db, jobs: recordingJobs().jobs });
  const mailer = { delivers: false, send: async () => {} };
  const auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN, mailer });
  const app = buildApp({ deps, auth, mailer, origin: ORIGIN });
  const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

  async function signUp() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: `oauth-${randomUUID()}@example.com`, password: 'correct horse battery', name: 'OAuth User' },
    });
    return { cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; '), userId: res.json().user.id as string };
  }

  async function registerClient() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth2/register',
      headers: { 'content-type': 'application/json' },
      payload: {
        client_name: 'Test MCP Client',
        application_type: 'native',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().client_id as string;
  }

  function authorizeUrl(clientId: string) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid offline_access',
      state: 'state-1',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
    });
    return { url: `/api/auth/oauth2/authorize?${query}`, verifier };
  }

  async function obtainToken(cookie: string) {
    const clientId = await registerClient();
    const { url: authorize, verifier } = authorizeUrl(clientId);
    const redirect = await app.inject({ method: 'GET', url: authorize, headers: { cookie } });
    expect(redirect.statusCode).toBe(302);
    const location = String(redirect.headers.location);
    expect(location.startsWith('/oauth/consent?')).toBe(true);

    const consent = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth2/consent',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { accept: true, oauth_query: location.slice(location.indexOf('?') + 1) },
    });
    expect(consent.statusCode, consent.body).toBe(200);
    const code = new URL(consent.json().url).searchParams.get('code') ?? '';

    const token = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    expect(token.statusCode, token.body).toBe(200);
    return token.json() as { access_token: string; refresh_token?: string };
  }

  const callTool = (token: string, name: string) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...mcpHeaders, authorization: `Bearer ${token}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } },
    });

  beforeAll(() => migrateDatabase(url ?? ''));
  afterAll(async () => {
    await app.close();
    await close();
  });

  it('advertises itself to unauthenticated MCP clients (RFC 9728 + RFC 8414)', async () => {
    const challenge = await app.inject({ method: 'POST', url: '/mcp', headers: mcpHeaders, payload: {} });
    expect(challenge.statusCode).toBe(401);
    expect(challenge.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    expect(resource.json()).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [`${ORIGIN}/api/auth`] });

    const server = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server/api/auth' });
    expect(server.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      client_id_metadata_document_supported: true,
    });
  });

  it('issues workspace-bound tokens that work on /mcp', async () => {
    const { cookie } = await signUp();
    const { access_token, refresh_token } = await obtainToken(cookie);
    expect(refresh_token).toBeTruthy();

    const claims = JSON.parse(Buffer.from(access_token.split('.')[1] ?? '', 'base64url').toString());
    expect(claims.aud).toContain(`${ORIGIN}/mcp`);
    expect(typeof claims.org_id).toBe('string');

    const result = await callTool(access_token, 'check_readiness');
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().result.content[0].text).toContain('"sites": []');

    const tampered = await callTool(`${access_token.slice(0, -4)}AAAA`, 'check_readiness');
    expect(tampered.statusCode).toBe(401);
    expect(tampered.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('asks users with several workspaces which one to grant', async () => {
    const { cookie, userId } = await signUp();
    await auth.api.createOrganization({ body: { name: 'Second', slug: `second-${randomUUID()}`, userId } });

    const clientId = await registerClient();
    const redirect = await app.inject({ method: 'GET', url: authorizeUrl(clientId).url, headers: { cookie } });
    expect(String(redirect.headers.location).startsWith('/oauth/workspace?')).toBe(true);
  });

  it('rejects tokens once the user leaves the workspace', async () => {
    const { cookie, userId } = await signUp();
    const { access_token } = await obtainToken(cookie);
    await db.delete(member).where(eq(member.userId, userId));
    expect((await callTool(access_token, 'check_readiness')).statusCode).toBe(401);
  });
});
