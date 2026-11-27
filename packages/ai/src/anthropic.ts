import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  type Credential,
  type ModelSpec,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from './types';

export class AnthropicProvider implements TextProvider {
  private readonly clients = new Map<string, Anthropic>();

  // `fetch` is a test seam for checking what goes over the wire.
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}

  async generateText(model: ModelSpec, credential: Credential, request: TextRequest): Promise<TextResult> {
    const client = this.client(credential.apiKey);
    try {
      // Streaming keeps long articles clear of HTTP timeouts. Thinking is always on for current models
      // and counts against max_tokens, so leave room well beyond the article itself. `fallbacks:
      // 'default'` re-runs a request declined by a safety classifier on Anthropic's recommended
      // fallback model; Haiku 5.5 has no server-side fallback, so it is only sent where supported.
      const message = await client.beta.messages
        .stream({
          model: model.providerModel,
          max_tokens: request.maxOutputTokens ?? 64000,
          ...(model.fallbacks && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
          output_config: { effort: model.effort ?? 'high' },
          cache_control: { type: 'ephemeral' },
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        })
        .finalMessage();

      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category ?? 'unspecified';
        throw new AiError('refusal', `The model declined this request (category: ${category}).`);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new AiError('truncated', 'The model hit its output limit before finishing.');
      }

      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return {
        text,
        servedBy: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (error) {
      throw toAiError(error);
    }
  }

  async verifyKey(apiKey: string): Promise<void> {
    try {
      await new Anthropic({ apiKey, maxRetries: 0, fetch: this.options.fetch }).models.list({ limit: 1 });
    } catch (error) {
      throw toAiError(error);
    }
  }

  private client(apiKey: string): Anthropic {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = new Anthropic({ apiKey, fetch: this.options.fetch });
      this.clients.set(apiKey, client);
    }
    return client;
  }
}

function toAiError(error: unknown): unknown {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limited', 'Anthropic rate limit reached; try again shortly.', true);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('no_credential', 'The Anthropic API key was rejected.');
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AiError('provider_error', `Anthropic rejected the request: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new AiError('provider_error', `Anthropic is unavailable: ${error.message}`, true);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError(
      'provider_error',
      `Anthropic error ${error.status}: ${error.message}`,
      (error.status ?? 0) >= 500,
    );
  }
  return error;
}
