import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { Db } from '@tricity/db';
import * as schema from '@tricity/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { jwt, organization } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { Mailer } from './mailer';

export interface AuthOptions {
  db: Db;
  secret: string;
  // Public origin of the dashboard. The browser reaches /api/auth/* through it.
  baseURL: string;
  mailer: Mailer;
  // open = anyone can create an account; invite = only the first account (the operator) and people
  // with a pending invitation.
  signupMode?: SignupMode;
  // Require a confirmed email address before signing in. Only possible when the mailer delivers.
  requireEmailVerification?: boolean;
  // Removes a workspace's own data (sites, articles, keys…) before Better Auth deletes the organization.
  onDeleteWorkspace?: (orgId: string) => Promise<void>;
  // Cleans up after a deleted account outside its workspaces (MCP keys).
  onDeleteUser?: (userId: string) => Promise<void>;
}

export type SignupMode = 'open' | 'invite';

// Invite-only sign-up carries the invitation's id (from its link) in this header. The id is the secret,
// as it is for accepting: knowing an invitee's email address must not be enough.
export const INVITATION_HEADER = 'x-tcw-invitation';

// MCP sign-in (OAuth 2.1) needs an HTTPS resource URL; plain HTTP is only allowed on loopback.
// On an IP address without TLS, OAuth stays off and MCP accepts bearer keys only.
export function oauthEnabled(baseURL: string): boolean {
  const url = new URL(baseURL);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

// Every account has a workspace of its own: created at sign-up, and again if the user ends up with none
// (their last workspace was deleted, or they were removed from it).
export async function createPersonalWorkspace(
  auth: Auth,
  user: { id: string; name?: string | null; email: string },
  unique = false,
) {
  const base = `ws-${user.id
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)}`;
  return auth.api.createOrganization({
    body: {
      name: `${user.name || user.email.split('@')[0]}'s workspace`,
      slug: unique ? `${base}-${Math.random().toString(36).slice(2, 8)}` : base,
      userId: user.id,
    },
  });
}

export function mcpResource(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/mcp`;
}

export function createAuth({
  db,
  secret,
  baseURL,
  mailer,
  signupMode = 'open',
  requireEmailVerification = false,
  onDeleteWorkspace = async () => {},
  onDeleteUser = async () => {},
}: AuthOptions) {
  const verifyEmails = requireEmailVerification && mailer.delivers;

  async function firstMembership(userId: string) {
    return db.query.member.findFirst({
      where: (m, { eq }) => eq(m.userId, userId),
      orderBy: (m, { asc }) => asc(m.createdAt),
    });
  }

  // Before an account goes: workspaces it shares with others must keep an owner; workspaces where it is
  // the only member are deleted with all their data.
  async function prepareAccountDeletion(userId: string): Promise<void> {
    const memberships = await db.query.member.findMany({ where: (m, { eq }) => eq(m.userId, userId) });
    const solo: string[] = [];
    for (const membership of memberships) {
      const members = await db.query.member.findMany({
        where: (m, { eq }) => eq(m.organizationId, membership.organizationId),
      });
      if (members.length === 1) {
        solo.push(membership.organizationId);
        continue;
      }
      const owners = members.filter((m) => m.role === 'owner');
      if (membership.role === 'owner' && owners.length === 1) {
        const org = await db.query.organization.findFirst({
          where: (o, { eq }) => eq(o.id, membership.organizationId),
        });
        throw new APIError('BAD_REQUEST', {
          code: 'SOLE_OWNER',
          message: `You're the only owner of "${org?.name ?? 'a workspace'}". Make another member an owner, or remove the other members, then try again.`,
        });
      }
    }
    for (const orgId of solo) {
      await onDeleteWorkspace(orgId);
      await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    }
    await onDeleteUser(userId);
  }

  // Invite-only installs still need someone to start: the very first account is always allowed. After
  // that, sign-up needs a pending, unexpired invitation for this email, identified by its id.
  async function maySignUp(email: string, invitationId: string | null | undefined): Promise<boolean> {
    if (signupMode === 'open') return true;
    if (!(await db.query.user.findFirst({ columns: { id: true } }))) return true;
    if (!invitationId) return false;
    const invited = await db.query.invitation.findFirst({
      columns: { id: true },
      where: (i, { and, eq, gt, sql }) =>
        and(
          eq(i.id, invitationId),
          eq(sql`lower(${i.email})`, email.toLowerCase()),
          eq(i.status, 'pending'),
          gt(i.expiresAt, new Date()),
        ),
    });
    return invited !== undefined;
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
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => prepareAccountDeletion(user.id),
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: verifyEmails,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'Reset your TriCity Writer password',
          text: `Someone asked to reset the password for ${user.email}.\n\nSet a new password: ${url}\n\nIf it wasn't you, ignore this email.`,
        });
      },
    },
    ...(verifyEmails && {
      emailVerification: {
        sendOnSignUp: true,
        // An unconfirmed sign-in attempt sends a fresh link, so expired links are never a dead end.
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        expiresIn: 24 * 60 * 60,
        sendVerificationEmail: async ({ user, url }) => {
          await mailer.send({
            to: user.email,
            subject: 'Confirm your email for TriCity Writer',
            text: `Confirm your email address to finish setting up your TriCity Writer account:\n\n${url}\n\nThe link works for 24 hours. If you didn't sign up, ignore this email.`,
          });
        },
      },
    }),
    plugins: [
      organization({
        invitationExpiresIn: 7 * 24 * 60 * 60,
        // Joining a workspace proves nothing unless the address is really yours.
        requireEmailVerificationOnInvitation: verifyEmails,
        organizationHooks: {
          beforeDeleteOrganization: async ({ organization: org, user }) => {
            const memberships = await db.query.member.findMany({ where: (m, { eq }) => eq(m.userId, user.id) });
            if (memberships.length <= 1) {
              throw new APIError('BAD_REQUEST', {
                code: 'LAST_WORKSPACE',
                message: 'This is your only workspace. To remove everything, delete your account instead.',
              });
            }
            await onDeleteWorkspace(org.id);
          },
        },
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
          before: async (user, context) => {
            const invitationId =
              context?.headers?.get(INVITATION_HEADER) ?? context?.request?.headers.get(INVITATION_HEADER);
            if (!(await maySignUp(user.email, invitationId))) {
              throw new APIError('FORBIDDEN', {
                code: 'SIGNUP_INVITE_ONLY',
                message:
                  'Sign-ups are by invitation only. Open the link in your invitation to create your account, or ask a workspace admin to invite you.',
              });
            }
          },
          // Every account starts with its own workspace (organization = tenant).
          after: async (user) => {
            await createPersonalWorkspace(auth, user);
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
