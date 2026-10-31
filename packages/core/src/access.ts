import type { Db } from '@tricity/db';
import type { Actor } from './deps';
import { AppError } from './errors';

export type Role = 'owner' | 'admin' | 'member';

// The user's role in a workspace, or null when they are not (or no longer) a member.
export async function memberRole(db: Db, orgId: string, userId: string): Promise<Role | null> {
  const membership = await db.query.member.findFirst({
    where: (m, { and, eq }) => and(eq(m.organizationId, orgId), eq(m.userId, userId)),
  });
  return membership ? (membership.role as Role) : null;
}

// Workspace settings that affect everyone (AI keys, removing sites) need an owner or admin.
export function requireAdmin(actor: Actor): void {
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new AppError('forbidden', 'Only workspace owners and admins can do this.');
  }
}
