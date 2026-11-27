// The only package that may import provider SDKs (Anthropic, OpenAI). Callers ask for a model by
// registry id; every call reports a UsageRecord so it can be metered per org/site.
import { AnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import { DEFAULT_MODELS } from './models';
import { OpenAIProvider } from './openai';
import {
  AiError,
  type Credential,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type ModelKind,
  type ModelSpec,
  type ProviderId,
  type TextProvider,
  type TextRequest,
  type TextResult,
  type TextUsage,
  type UsageRecord,
} from './types';

export { DEFAULT_MODELS } from './models';
export * from './types';

export class ModelRegistry {
  private readonly models = new Map<string, ModelSpec>();

  constructor(models: readonly ModelSpec[]) {
    for (const model of models) {
      if (this.models.has(model.id)) throw new Error(`Duplicate model id: ${model.id}`);
      this.models.set(model.id, model);
    }
  }

  get(id: string): ModelSpec {
    const model = this.models.get(id);
    if (!model) throw new AiError('unknown_model', `Unknown model: ${id}`);
    return model;
  }

  list(kind?: ModelKind): ModelSpec[] {
    return [...this.models.values()].filter((m) => !kind || m.kind === kind);
  }
}

export interface AiServiceOptions {
  models?: readonly ModelSpec[];
  // Platform-held keys. A workspace's own keys (OrgKeys) take precedence per call.
  platformKeys: Partial<Record<ProviderId, string>>;
  // false = workspaces must bring their own keys; platform keys are never used.
  allowPlatformKeys?: boolean;
  // When set, every call is served by FakeProvider with this text. For local dev and tests.
  fake?: (request: TextRequest) => string;
  // Test seams.
  textProviders?: Partial<Record<ProviderId, TextProvider>>;
  imageProviders?: Partial<Record<ProviderId, ImageProvider>>;
}

export interface ModelAvailability {
  id: string;
  label: string;
  description: string;
  kind: ModelKind;
  provider: ProviderId;
  available: boolean;
}

type UsageSink = (usage: UsageRecord) => Promise<void> | void;

// A workspace's own provider keys (BYOK). They take precedence over platform keys.
export type OrgKeys = Partial<Record<ProviderId, string>>;

export class AiService {
  readonly registry: ModelRegistry;
  private readonly keys: Partial<Record<ProviderId, string>>;
  private readonly allowPlatformKeys: boolean;
  private readonly fake: FakeProvider | undefined;
  private readonly textProviders: Record<ProviderId, TextProvider>;
  private readonly imageProviders: Partial<Record<ProviderId, ImageProvider>>;

  constructor(options: AiServiceOptions) {
    this.registry = new ModelRegistry(options.models ?? DEFAULT_MODELS);
    this.keys = options.platformKeys;
    this.allowPlatformKeys = options.allowPlatformKeys ?? true;
    this.fake = options.fake ? new FakeProvider(options.fake) : undefined;
    const openai = new OpenAIProvider();
    this.textProviders = { anthropic: new AnthropicProvider(), openai, ...options.textProviders };
    this.imageProviders = { openai, ...options.imageProviders };
  }

  get isFake(): boolean {
    return this.fake !== undefined;
  }

  models(org: OrgKeys = {}): ModelAvailability[] {
    return this.registry.list().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      kind: m.kind,
      provider: m.provider,
      available: this.isFake || this.credential(m.provider, org) !== undefined,
    }));
  }

  // The preferred available model of a kind, or undefined when no provider has a key.
  defaultModel(kind: ModelKind, org: OrgKeys = {}): ModelSpec | undefined {
    const usable = this.registry.list(kind).filter((m) => this.isFake || this.credential(m.provider, org));
    return usable.find((m) => m.default) ?? usable[0];
  }

  // Whose key a call to this model would use: the workspace's own, the platform's, or none. Fake
  // mode reports undefined because nobody pays.
  credentialOwner(modelId: string, org: OrgKeys = {}): Credential['owner'] | undefined {
    if (this.fake) return undefined;
    const model = this.registry.list().find((m) => m.id === modelId);
    return model ? this.credential(model.provider, org)?.owner : undefined;
  }

  // Checks a key against the provider without spending tokens (lists models).
  async verifyKey(provider: ProviderId, apiKey: string): Promise<void> {
    if (this.fake) return;
    await this.textProviders[provider].verifyKey(apiKey);
  }

  async generateText(
    modelId: string,
    request: TextRequest,
    onUsage: UsageSink,
    org: OrgKeys = {},
  ): Promise<TextResult> {
    const model = this.registry.get(modelId);
    if (model.kind !== 'text') throw new AiError('unknown_model', `${model.label} is not a text model.`);

    if (this.fake) {
      const result = await this.fake.generateText(model, { owner: 'platform', apiKey: '' }, request);
      await onUsage(textUsage('fake', model, 'platform', result.usage, false));
      return result;
    }
    const credential = this.requireCredential(model, org);
    const result = await this.textProviders[model.provider].generateText(model, credential, request);
    await onUsage(textUsage(model.provider, model, credential.owner, result.usage, true));
    return result;
  }

  async generateImage(
    modelId: string,
    request: ImageRequest,
    onUsage: UsageSink,
    org: OrgKeys = {},
  ): Promise<ImageResult> {
    const model = this.registry.get(modelId);
    if (model.kind !== 'image') throw new AiError('unknown_model', `${model.label} is not an image model.`);

    if (this.fake) {
      const result = await this.fake.generateImage(model, null, request);
      await onUsage(imageUsage('fake', model, 'platform', false));
      return result;
    }
    const provider = this.imageProviders[model.provider];
    if (!provider) throw new AiError('unknown_model', `${model.provider} has no image provider.`);
    const credential = this.requireCredential(model, org);
    const result = await provider.generateImage(model, credential, request);
    await onUsage(imageUsage(model.provider, model, credential.owner, true));
    return result;
  }

  private credential(provider: ProviderId, org: OrgKeys): Credential | undefined {
    const own = org[provider];
    if (own) return { owner: 'org', apiKey: own };
    const platform = this.allowPlatformKeys ? this.keys[provider] : undefined;
    return platform ? { owner: 'platform', apiKey: platform } : undefined;
  }

  private requireCredential(model: ModelSpec, org: OrgKeys): Credential {
    const credential = this.credential(model.provider, org);
    if (!credential) {
      throw new AiError(
        'no_credential',
        `No ${model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key is available for ${model.label}. Add one under Settings → AI keys.`,
      );
    }
    return credential;
  }
}

function textUsage(
  provider: UsageRecord['provider'],
  model: ModelSpec,
  owner: Credential['owner'],
  usage: TextUsage,
  priced: boolean,
): UsageRecord {
  const price = priced && model.pricing && 'inputPerMTok' in model.pricing ? model.pricing : undefined;
  // USD per million tokens × tokens = micro-USD. Cache writes cost 1.25×, cache reads 0.1× input.
  const cost = price
    ? usage.inputTokens * price.inputPerMTok +
      usage.cacheWriteTokens * price.inputPerMTok * 1.25 +
      usage.cacheReadTokens * price.inputPerMTok * 0.1 +
      usage.outputTokens * price.outputPerMTok
    : 0;
  return {
    kind: 'text',
    provider,
    model: model.id,
    credentialOwner: owner,
    inputTokens: usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens,
    outputTokens: usage.outputTokens,
    images: 0,
    costMicroUsd: Math.round(cost),
  };
}

function imageUsage(
  provider: UsageRecord['provider'],
  model: ModelSpec,
  owner: Credential['owner'],
  priced: boolean,
): UsageRecord {
  const price = priced && model.pricing && 'perImage' in model.pricing ? model.pricing.perImage : 0;
  return {
    kind: 'image',
    provider,
    model: model.id,
    credentialOwner: owner,
    inputTokens: 0,
    outputTokens: 0,
    images: 1,
    costMicroUsd: Math.round(price * 1_000_000),
  };
}
