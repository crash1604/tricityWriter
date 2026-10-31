import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same-origin: /api/auth/* is proxied to apps/api. oauthProviderClient carries the signed OAuth request
// through sign-in, consent and workspace selection when an MCP client connects.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [organizationClient(), oauthProviderClient()],
});
