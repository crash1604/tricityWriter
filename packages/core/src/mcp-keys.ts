import { randomBytes } from 'node:crypto';
import { forOrg, system } from '@tricity/db';
import { sha256 } from './crypto';
import type { Actor, CoreDeps } from './deps';
import { invalid, notFound } from './errors';
import { isUuid } from './ids';

// Bearer keys for the MCP endpoint. The plain key is shown once; only its hash is stored.
const PREFIX = 'tcw_mcp_';

export async function createMcpKey(deps: CoreDeps, actor: Actor, name: string) {
  if (!actor.userId) throw invalid('MCP keys belong to a user.');
  const label = name.trim();
  if (!label || label.length > 80) throw invalid('Give the key a name (up to 80 characters).');

  const key = `${PREFIX}${randomBytes(24).toString('base64url')}`;
  const record = await forOrg(deps.db, actor.orgId).mcpKeys.create({
    userId: actor.userId,
    name: label,
    prefix: key.slice(0, PREFIX.length + 4),
    keyHash: sha256(key),
  });
  return { key, id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt };
}

export function listMcpKeys(deps: CoreDeps, actor: Actor) {
  return forOrg(deps.db, actor.orgId).mcpKeys.list();
}

export async function revokeMcpKey(deps: CoreDeps, actor: Actor, id: string): Promise<void> {
  if (!isUuid(id) || !(await forOrg(deps.db, actor.orgId).mcpKeys.revoke(id))) {
    throw notFound('MCP key');
  }
}

// Resolves a bearer key to the org and user it acts as, or null.
export async function verifyMcpKey(deps: CoreDeps, key: string): Promise<Required<Actor> | null> {
  if (!key.startsWith(PREFIX)) return null;
  const record = await system.findMcpKeyByHash(deps.db, sha256(key));
  if (!record) return null;
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
    await system.touchMcpKey(deps.db, record.id);
  }
  return { orgId: record.orgId, userId: record.userId };
}
