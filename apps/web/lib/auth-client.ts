import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Same-origin: /api/auth/* is proxied to apps/api by next.config.ts.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [organizationClient()],
});
