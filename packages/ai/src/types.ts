export type ProviderId = 'anthropic' | 'openai';
export type ModelKind = 'text' | 'image';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelSpec {
  // Our stable id, stored in templates, profiles and generations.
  id: string;
  provider: ProviderId;
  kind: ModelKind;
  // The provider's model id. Changing it must not break callers.
  providerModel: string;
  label: string;
  description: string;
  // Prices in USD. Models without a price record usage with cost 0.
  pricing?: { inputPerMTok: number; outputPerMTok: number } | { perImage: number };
  // Reasoning effort for text models that support it.
  effort?: Effort;
  // Preferred default for its kind when its provider has a key.
  default?: boolean;
}

// Who supplied the API key. v1 only has platform keys; per-org keys (BYOK) come later.
export interface Credential {
  owner: 'platform' | 'org';
  apiKey: string;
}

export interface TextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface TextRequest {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface TextResult {
  text: string;
  usage: TextUsage;
  // The model that actually served the request (differs after a server-side fallback).
  servedBy: string;
}

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface ImageRequest {
  prompt: string;
  size: ImageSize;
}

export interface ImageResult {
  data: Uint8Array;
  mimeType: string;
}

export interface TextProvider {
  generateText(model: ModelSpec, credential: Credential, request: TextRequest): Promise<TextResult>;
  // Throws AiError('no_credential') when the provider rejects the key.
  verifyKey(apiKey: string): Promise<void>;
}

export interface ImageProvider {
  generateImage(model: ModelSpec, credential: Credential, request: ImageRequest): Promise<ImageResult>;
}

export type AiErrorCode =
  | 'unknown_model'
  | 'no_credential'
  | 'refusal'
  | 'truncated'
  | 'rate_limited'
  | 'provider_error';

export class AiError extends Error {
  readonly code: AiErrorCode;
  // Worth retrying later (rate limits, overload, network).
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
  }
}

// One metered call, recorded by the caller against org and site.
export interface UsageRecord {
  kind: ModelKind;
  provider: ProviderId | 'fake';
  model: string;
  credentialOwner: Credential['owner'];
  inputTokens: number;
  outputTokens: number;
  images: number;
  costMicroUsd: number;
}
