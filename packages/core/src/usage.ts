import { forOrg } from '@tricity/db';
import type { Actor, CoreDeps } from './deps';

// This calendar month's AI usage (UTC), by model. The basis for billing later.
export async function usageSummary(deps: CoreDeps, actor: Actor, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const scope = forOrg(deps.db, actor.orgId);
  const byModel = (await scope.usage.summary(since)).map((row) => ({
    ...row,
    costMicroUsd: Number(row.costMicroUsd),
  }));
  return {
    since: since.toISOString(),
    articles: await scope.usage.generationsSince(since),
    byModel,
    totals: {
      inputTokens: byModel.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: byModel.reduce((s, r) => s + r.outputTokens, 0),
      images: byModel.reduce((s, r) => s + r.images, 0),
      costUsd: byModel.reduce((s, r) => s + r.costMicroUsd, 0) / 1_000_000,
    },
  };
}
