import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { type Actor, type CoreDeps, memberRole } from '@tricity/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from 'jose';
import type { Auth } from './auth';
import { sendResponse, toFetchRequest } from './http';

// MCP sign-in. Better Auth (with the mcp plugin) is the OAuth 2.1 authorization server under
// /api/auth; this module exposes its discovery documents at the domain root, where MCP clients look
// for them, and verifies the access tokens it issues.

export interface OAuthConfig {
  origin: string;
  resource: string;
}

export function registerOAuthDiscovery(app: FastifyInstance, auth: Auth, { origin }: OAuthConfig): void {
  // RFC 9728: the metadata for https://host/mcp lives at /.well-known/oauth-protected-resource/mcp.
  // The mcp plugin answers these root paths itself when the request reaches Better Auth unchanged.
  const protectedResource = async (request: FastifyRequest) =>
    auth.handler(toFetchRequest(request, `${origin}${request.url}`));
  // RFC 8414 and OIDC discovery for the issuer under /api/auth (path-inserted and plain forms).
  const authServer = oauthProviderAuthServerMetadata(auth as never);
  const openIdConfig = oauthProviderOpenIdConfigMetadata(auth as never);

  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*']) {
    app.get(path, async (request, reply) => sendResponse(reply, await protectedResource(request)));
  }
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*']) {
    app.get(path, async (request, reply) => sendResponse(reply, await authServer(toFetchRequest(request))));
  }
  for (const path of ['/.well-known/openid-configuration', '/.well-known/openid-configuration/*']) {
    app.get(path, async (request, reply) => sendResponse(reply, await openIdConfig(toFetchRequest(request))));
  }
}

// Verifies an OAuth access token in-process against our own JWKS (no network round trip) and
// resolves the workspace it was granted for. Tokens must be audience-bound to the MCP resource.
export function createOAuthVerifier(auth: Auth, deps: CoreDeps, { origin, resource }: OAuthConfig) {
  let keys: ReturnType<typeof createLocalJWKSet> | null = null;

  async function keySet(refresh: boolean) {
    if (!keys || refresh) {
      const response = await auth.handler(new Request(`${origin}/api/auth/jwks`));
      keys = createLocalJWKSet((await response.json()) as JSONWebKeySet);
    }
    return keys;
  }

  return async function verify(token: string): Promise<Required<Actor> | null> {
    for (const refresh of [false, true]) {
      try {
        const { payload } = await jwtVerify(token, await keySet(refresh), { audience: resource });
        const orgId = typeof payload.org_id === 'string' ? payload.org_id : null;
        if (!payload.sub || !orgId) return null;
        const role = await memberRole(deps.db, orgId, payload.sub);
        return role ? { orgId, userId: payload.sub, role } : null;
      } catch (error) {
        // A key rotation shows up as an unknown key id: reload the key set once.
        if (error instanceof errors.JWKSNoMatchingKey && !refresh) continue;
        return null;
      }
    }
    return null;
  };
}
