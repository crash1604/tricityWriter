import { describe, expect, it } from 'vitest';
import { AiError, AiService, ModelRegistry, type ModelSpec, type TextProvider, type UsageRecord } from './index';

const writer: ModelSpec = {
  id: 'writer',
  provider: 'anthropic',
  kind: 'text',
  providerModel: 'x',
  label: 'Writer',
  description: '',
  pricing: { inputPerMTok: 4, outputPerMTok: 20 },
  default: true,
};
const cheap: ModelSpec = { ...writer, id: 'cheap', label: 'Cheap', pricing: undefined, default: false };
const illustrator: ModelSpec = {
  id: 'illustrator',
  provider: 'openai',
  kind: 'image',
  providerModel: 'y',
  label: 'Illustrator',
  description: '',
};

const stubText: TextProvider = {
  async generateText() {
    return {
      text: 'hello',
      servedBy: 'x',
      usage: { inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 0, cacheReadTokens: 2000 },
    };
  },
};

describe('ModelRegistry', () => {
  it('looks models up by id and filters by kind', () => {
    const registry = new ModelRegistry([writer, illustrator]);
    expect(registry.get('writer')).toBe(writer);
    expect(registry.list('image')).toEqual([illustrator]);
  });

  it('rejects unknown and duplicate ids', () => {
    expect(() => new ModelRegistry([writer, writer])).toThrow(/Duplicate/);
    expect(() => new ModelRegistry([writer]).get('nope')).toThrow(/Unknown model/);
  });
});

describe('AiService', () => {
  it('reports usage with an estimated cost', async () => {
    const ai = new AiService({
      models: [writer, illustrator],
      platformKeys: { anthropic: 'k' },
      textProviders: { anthropic: stubText },
    });
    const records: UsageRecord[] = [];
    await ai.generateText('writer', { system: '', prompt: 'p' }, (u) => {
      records.push(u);
    });

    // 1000 × $4 + 2000 × $0.40 + 500 × $20, per million tokens = $0.0148
    expect(records).toEqual([
      {
        kind: 'text',
        provider: 'anthropic',
        model: 'writer',
        credentialOwner: 'platform',
        inputTokens: 3000,
        outputTokens: 500,
        images: 0,
        costMicroUsd: 14_800,
      },
    ]);
  });

  it('marks models unavailable without a key and fails with no_credential', async () => {
    const ai = new AiService({ models: [writer, illustrator], platformKeys: { anthropic: 'k' } });
    expect(ai.models().find((m) => m.id === 'illustrator')?.available).toBe(false);
    expect(ai.defaultModel('image')).toBeUndefined();
    await expect(ai.generateImage('illustrator', { prompt: 'p', size: '1024x1024' }, () => {})).rejects.toMatchObject({
      code: 'no_credential',
    });
  });

  it('prefers the default model among available ones', () => {
    const ai = new AiService({ models: [cheap, writer], platformKeys: { anthropic: 'k' } });
    expect(ai.defaultModel('text')?.id).toBe('writer');
  });

  it('serves every call from the fake provider when configured', async () => {
    const ai = new AiService({ models: [writer, illustrator], platformKeys: {}, fake: () => 'fake article' });
    const records: UsageRecord[] = [];
    const text = await ai.generateText('writer', { system: 's', prompt: 'p' }, (u) => {
      records.push(u);
    });
    const image = await ai.generateImage('illustrator', { prompt: 'a cat', size: '1536x1024' }, (u) => {
      records.push(u);
    });

    expect(text.text).toBe('fake article');
    expect(image.mimeType).toBe('image/svg+xml');
    expect(records.map((r) => [r.provider, r.costMicroUsd])).toEqual([
      ['fake', 0],
      ['fake', 0],
    ]);
  });

  it('rejects using a text model for images', async () => {
    const ai = new AiService({ models: [writer], platformKeys: { anthropic: 'k' } });
    await expect(ai.generateImage('writer', { prompt: 'p', size: '1024x1024' }, () => {})).rejects.toBeInstanceOf(
      AiError,
    );
  });
});
