import type { OrgKeys } from '@tricity/ai';
import { system } from '@tricity/db';
import type { CoreDeps } from './deps';
import { AppError } from './errors';
import type { GenerationOptions } from './generation/types';

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface PlatformAllowance {
  // null = no cap configured.
  budgetUsd: number | null;
  // Spent this month through platform keys by every workspace with the same owner(s).
  usedUsd: number;
  since: string;
}

// The budget belongs to the accounts that own a workspace: creating another workspace doesn't reset it.
export async function platformAllowance(deps: CoreDeps, orgId: string, now = new Date()): Promise<PlatformAllowance> {
  const since = monthStart(now);
  const used = await system.platformCostOfOwners(deps.db, orgId, since);
  return {
    budgetUsd: deps.limits?.platformMonthlyBudgetUsd ?? null,
    usedUsd: used / 1_000_000,
    since: since.toISOString(),
  };
}

// The models an article with these options will call: its text model and, if it wants images, its
// image model (explicit choices, else the workspace's defaults).
export function plannedModels(
  deps: CoreDeps,
  keys: OrgKeys,
  options: Pick<GenerationOptions, 'textModel' | 'imageModel' | 'featuredImage' | 'inlineImages'>,
): (string | undefined)[] {
  const wantsImages = options.featuredImage || options.inlineImages > 0;
  return [
    options.textModel ?? deps.ai.defaultModel('text', keys)?.id,
    wantsImages ? (options.imageModel ?? deps.ai.defaultModel('image', keys)?.id) : undefined,
  ];
}

// Refuses work that would run on platform-held keys once the owners' monthly budget is used. Checked
// before an article starts, so one article can overshoot by at most its own cost.
export async function assertPlatformBudget(
  deps: CoreDeps,
  orgId: string,
  keys: OrgKeys,
  modelIds: readonly (string | null | undefined)[],
): Promise<void> {
  const budget = deps.limits?.platformMonthlyBudgetUsd;
  if (budget === undefined) return;
  const onPlatformKeys = modelIds.some((id) => id && deps.ai.credentialOwner(id, keys) === 'platform');
  if (!onPlatformKeys) return;
  const { usedUsd } = await platformAllowance(deps, orgId);
  if (usedUsd >= budget) {
    throw new AppError(
      'quota_exceeded',
      `This workspace's included AI usage for the month is used up ($${budget.toFixed(2)}, shared by every workspace with the same owner). Add your own Anthropic or OpenAI key under Settings → AI keys to keep writing, or wait until next month.`,
    );
  }
}

export function tooManyInProgress(max: number): AppError {
  return new AppError(
    'too_many',
    `This workspace already has ${max} articles in progress. Wait for some to finish, then try again.`,
  );
}
