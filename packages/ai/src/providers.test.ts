// Wire-level checks for the provider adapters: the request bodies and headers we send, and how
// responses (including usage) are read back. No network: the SDKs get a recording fetch.
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic';
import { DEFAULT_MODELS } from './models';
import { OpenAIProvider } from './openai';
import type { ModelSpec } from './types';

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function recorder(respond: (url: string) => Response) {
  const calls: Captured[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return respond(url);
  }) as typeof fetch;
  return { impl, calls };
}

function model(id: string): ModelSpec {
  const found = DEFAULT_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(id);
  return found;
}

function sse(events: unknown[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function anthropicStream(text: string, stopReason = 'end_turn', modelId = 'claude-opus-5-5') {
  return sse([
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: modelId,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 300, cache_read_input_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 900 } },
    { type: 'message_stop' },
  ]);
}

describe('AnthropicProvider', () => {
  it('streams with effort, caching and server-side fallbacks on Opus 5.5', async () => {
    const wire = recorder(() => anthropicStream('<post_title>Hi</post_title>'));
    const provider = new AnthropicProvider({ fetch: wire.impl });
    const result = await provider.generateText(
      model('claude-opus-5-5'),
      { owner: 'platform', apiKey: 'sk-ant-test' },
      { system: 'sys', prompt: 'write', maxOutputTokens: 64000 },
    );

    expect(result.text).toBe('<post_title>Hi</post_title>');
    expect(result.servedBy).toBe('claude-opus-5-5');
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 900, cacheWriteTokens: 300, cacheReadTokens: 0 });

    const [call] = wire.calls;
    expect(call?.url).toContain('/v1/messages');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    // SDK 1.x sends the API key as a bearer token on API version 2026-10-21.
    expect(call?.headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(call?.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      system: 'sys',
      messages: [{ role: 'user', content: 'write' }],
    });
    expect(call?.body).not.toHaveProperty('thinking');
    expect(call?.body).not.toHaveProperty('temperature');
  });

  it('sends no fallbacks to Haiku 5.5, which has no server-side fallback', async () => {
    const wire = recorder(() => anthropicStream('ok', 'end_turn', 'claude-haiku-5-5'));
    await new AnthropicProvider({ fetch: wire.impl }).generateText(
      model('claude-haiku-5-5'),
      { owner: 'org', apiKey: 'k' },
      { system: '', prompt: 'p' },
    );
    const [call] = wire.calls;
    expect(call?.body).not.toHaveProperty('fallbacks');
    expect(call?.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    expect(call?.body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'medium' } });
  });

  it('turns refusals and truncation into AiErrors', async () => {
    const refused = new AnthropicProvider({ fetch: recorder(() => anthropicStream('', 'refusal')).impl });
    await expect(
      refused.generateText(model('claude-opus-5-5'), { owner: 'org', apiKey: 'k' }, { system: '', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'refusal' });

    const cut = new AnthropicProvider({ fetch: recorder(() => anthropicStream('half', 'max_tokens')).impl });
    await expect(
      cut.generateText(model('claude-opus-5-5'), { owner: 'org', apiKey: 'k' }, { system: '', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'truncated' });
  });

  it('reports a rejected key as no_credential', async () => {
    const wire = recorder(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(new AnthropicProvider({ fetch: wire.impl }).verifyKey('k')).rejects.toMatchObject({
      code: 'no_credential',
    });
  });
});

describe('OpenAIProvider', () => {
  it('uses the Responses API and prices cached input once', async () => {
    const wire = recorder(
      () =>
        new Response(
          JSON.stringify({
            id: 'resp_1',
            object: 'response',
            created_at: 0,
            status: 'completed',
            model: 'gpt-5.5',
            output: [
              {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 1000,
              input_tokens_details: { cached_tokens: 400 },
              output_tokens: 200,
              output_tokens_details: { reasoning_tokens: 50 },
              total_tokens: 1200,
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const result = await new OpenAIProvider({ fetch: wire.impl }).generateText(
      model('gpt-5.5'),
      { owner: 'org', apiKey: 'sk-test' },
      { system: 'sys', prompt: 'write' },
    );
    expect(result.text).toBe('Hello');
    expect(result.usage).toEqual({ inputTokens: 600, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 400 });
    expect(wire.calls[0]?.url).toContain('/responses');
    expect(wire.calls[0]?.body).toMatchObject({
      model: 'gpt-5.5',
      instructions: 'sys',
      input: 'write',
      max_output_tokens: 64000,
    });
  });

  it('requests one medium-quality PNG and decodes it', async () => {
    const png = Buffer.from('fake-png');
    const wire = recorder(
      () =>
        new Response(JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const image = await new OpenAIProvider({ fetch: wire.impl }).generateImage(
      model('gpt-image-2'),
      { owner: 'org', apiKey: 'sk-test' },
      { prompt: 'a lighthouse', size: '1536x1024' },
    );
    expect(Buffer.from(image.data).toString()).toBe('fake-png');
    expect(wire.calls[0]?.url).toContain('/images/generations');
    expect(wire.calls[0]?.body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'a lighthouse',
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    });
  });
});

describe('DEFAULT_MODELS', () => {
  it('prices every model so platform budgets see all spend', () => {
    for (const m of DEFAULT_MODELS) expect(m.pricing, m.id).toBeDefined();
  });
});
