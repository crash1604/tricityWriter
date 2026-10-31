import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { Db } from '@tricity/db';
import * as schema from '@tricity/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, organization } from 'better-auth/plugins';
import type { Mailer } from './mailer';

export interface AuthOptions {
  db: Db;
  secret: string;
  // Public origin of the dashboard. The browser reaches /api/auth/* through it.
  baseURL: string;
  mailer: Mailer;
}

// MCP sign-in (OAuth 2.1) needs an HTTPS resource URL; plain HTTP is only allowed on loopback.
// On an IP address without TLS, OAuth stays off and MCP accepts bearer keys only.
export function oauthEnabled(baseURL: string): boolean {
  const url = new URL(baseURL);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function mcpResource(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/mcp`;
}

export function createAuth({ db, secret, baseURL, mailer }: AuthOptions) {
  async function firstMembership(userId: string) {
    return db.query.member.findFirst({
      where: (m, { eq }) => eq(m.userId, userId),
      orderBy: (m, { asc }) => asc(m.createdAt),
    });
  }

  const oauthPlugins = oauthEnabled(baseURL)
    ? [
        jwt(),
        mcp({
          resource: mcpResource(baseURL),
          loginPage: '/sign-in',
          consentPage: '/oauth/consent',
          // MCP clients that predate Client ID Metadata Documents register dynamically.
          allowDynamicClientRegistration: true,
          allowUnauthenticatedClientRegistration: true,
          // Every token acts for exactly one workspace: the one chosen during authorization.
          postLogin: {
            page: '/oauth/workspace',
            shouldRedirect: async ({ user, isContinuation }) => {
              if (isContinuation) return false;
              const memberships = await db.query.member.findMany({ where: (m, { eq }) => eq(m.userId, user.id) });
              return memberships.length > 1;
            },
            consentReferenceId: async ({ user, session }) => {
              const active = session.activeOrganizationId as string | null | undefined;
              return active ?? (await firstMembership(user.id))?.organizationId;
            },
          },
          customAccessTokenClaims: ({ referenceId }) => ({ org_id: referenceId ?? null }),
        }),
        cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      ]
    : [];

  const auth = betterAuth({
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'Reset your TriCity Writer password',
          text: `Someone asked to reset the password for ${user.email}.\n\nSet a new password: ${url}\n\nIf it wasn't you, ignore this email.`,
        });
      },
    },
    plugins: [
      organization({
        invitationExpiresIn: 7 * 24 * 60 * 60,
        sendInvitationEmail: async ({ email, inviter, organization: org, id }) => {
          await mailer.send({
            to: email,
            subject: `${inviter.user.name} invited you to ${org.name} on TriCity Writer`,
            text: `Accept the invitation: ${baseURL}/accept-invite/${id}`,
          });
        },
      }),
      ...oauthPlugins,
    ],
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
            const membership = await firstMembership(session.userId);
            return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
          },
        },
      },
    },
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
