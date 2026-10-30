import type { Db } from '@tricity/db';
import * as schema from '@tricity/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';

export interface AuthOptions {
  db: Db;
  secret: string;
  // Public origin of the dashboard. The browser reaches /api/auth/* through it (Next rewrites).
  baseURL: string;
}

export function createAuth({ db, secret, baseURL }: AuthOptions) {
  const auth = betterAuth({
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    plugins: [organization()],
    databaseHooks: {
      user: {
        create: {
          // Every account starts with its own workspace (organization = tenant).
          after: async (user) => {
            await auth.api.createOrganization({
              body: {
                name: `${user.name || user.email.split('@')[0]}'s workspace`,
                slug: `ws-${user.id
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '')
                  .slice(0, 12)}`,
                userId: user.id,
              },
            });
          },
        },
      },
      session: {
        create: {
          // New sessions open in the user's first workspace.
          before: async (session) => {
            const membership = await db.query.member.findFirst({
              where: (m, { eq }) => eq(m.userId, session.userId),
              orderBy: (m, { asc }) => asc(m.createdAt),
            });
            return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
          },
        },
      },
    },
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
