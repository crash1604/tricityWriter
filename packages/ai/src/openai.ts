import OpenAI from 'openai';
import {
  AiError,
  type Credential,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type ModelSpec,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from './types';

export class OpenAIProvider implements TextProvider, ImageProvider {
  private readonly clients = new Map<string, OpenAI>();

  async generateText(model: ModelSpec, credential: Credential, request: TextRequest): Promise<TextResult> {
    try {
      const response = await this.client(credential.apiKey).responses.create({
        model: model.providerModel,
        instructions: request.system,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens ?? 32000,
      });
      if (response.status === 'incomplete') {
        const reason = response.incomplete_details?.reason ?? 'unknown';
        throw reason === 'content_filter'
          ? new AiError('refusal', 'The model declined this request.')
          : new AiError('truncated', `The model stopped early (${reason}).`);
      }
      return {
        text: response.output_text,
        servedBy: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheWriteTokens: 0,
          cacheReadTokens: response.usage?.input_tokens_details.cached_tokens ?? 0,
        },
      };
    } catch (error) {
      throw toAiError(error);
    }
  }

  async generateImage(model: ModelSpec, credential: Credential, request: ImageRequest): Promise<ImageResult> {
    try {
      const response = await this.client(credential.apiKey).images.generate({
        model: model.providerModel,
        prompt: request.prompt,
        size: request.size,
        quality: 'medium',
        output_format: 'png',
        n: 1,
      });
      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new AiError('provider_error', 'OpenAI returned no image data.');
      return { data: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
    } catch (error) {
      throw toAiError(error);
    }
  }

  async verifyKey(apiKey: string): Promise<void> {
    try {
      await new OpenAI({ apiKey, maxRetries: 0 }).models.list();
    } catch (error) {
      throw toAiError(error);
    }
  }

  private client(apiKey: string): OpenAI {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = new OpenAI({ apiKey });
      this.clients.set(apiKey, client);
    }
    return client;
  }
}

function toAiError(error: unknown): unknown {
  if (error instanceof AiError) return error;
  if (error instanceof OpenAI.RateLimitError) {
    return new AiError('rate_limited', 'OpenAI rate limit reached; try again shortly.', true);
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new AiError('no_credential', 'The OpenAI API key was rejected.');
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) {
    return new AiError('provider_error', `OpenAI is unavailable: ${error.message}`, true);
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    return new AiError('provider_error', `OpenAI error ${status}: ${error.message}`, status >= 500);
  }
  return error;
}
