import { AiError, type OrgKeys, type ProviderId } from '@tricity/ai';
import { forOrg } from '@tricity/db';
import { requireAdmin } from './access';
import { decryptSecret, encryptSecret } from './crypto';
import type { Actor, CoreDeps } from './deps';
import { AppError, invalid, notFound } from './errors';

// A workspace's own provider keys (BYOK). Stored encrypted; only the last four characters are shown.

export const AI_PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai'];
const LABEL: Record<ProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };

export async function orgKeys(deps: CoreDeps, orgId: string): Promise<OrgKeys> {
  const rows = await forOrg(deps.db, orgId).aiCredentials.list();
  return Object.fromEntries(rows.map((r) => [r.provider, decryptSecret(r.keyCiphertext, deps.encryptionKey)]));
}

export async function listAiKeys(deps: CoreDeps, actor: Actor) {
  const rows = await forOrg(deps.db, actor.orgId).aiCredentials.list();
  return rows.map((r) => ({ provider: r.provider, last4: r.keyLast4, updatedAt: r.updatedAt }));
}

export async function setAiKey(deps: CoreDeps, actor: Actor, provider: ProviderId, apiKey: string) {
  requireAdmin(actor);
  if (!AI_PROVIDERS.includes(provider)) throw invalid('Unknown provider.');
  const key = apiKey.trim();
  if (key.length < 20 || /\s/.test(key)) throw invalid(`That doesn't look like an ${LABEL[provider]} API key.`);

  try {
    await deps.ai.verifyKey(provider, key);
  } catch (error) {
    if (error instanceof AiError && error.code === 'no_credential') {
      throw invalid(`${LABEL[provider]} rejected this key. Check it and try again.`);
    }
    if (error instanceof AiError) throw new AppError('ai_error', `Could not verify the key: ${error.message}`);
    throw error;
  }

  const row = await forOrg(deps.db, actor.orgId).aiCredentials.upsert(provider, {
    keyCiphertext: encryptSecret(key, deps.encryptionKey),
    keyLast4: key.slice(-4),
    createdBy: actor.userId,
  });
  return { provider: row.provider, last4: row.keyLast4, updatedAt: row.updatedAt };
}

export async function removeAiKey(deps: CoreDeps, actor: Actor, provider: ProviderId): Promise<void> {
  requireAdmin(actor);
  if (!(await forOrg(deps.db, actor.orgId).aiCredentials.remove(provider))) throw notFound('AI key');
}

// Models with availability for this workspace (its own keys, then platform keys).
export async function availableModels(deps: CoreDeps, actor: Actor) {
  const keys = await orgKeys(deps, actor.orgId);
  return {
    models: deps.ai.models(keys),
    defaults: {
      text: deps.ai.defaultModel('text', keys)?.id ?? null,
      image: deps.ai.defaultModel('image', keys)?.id ?? null,
    },
    fake: deps.ai.isFake,
    ownKeys: Object.keys(keys) as ProviderId[],
  };
}
