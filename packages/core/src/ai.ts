import { AiService } from '@tricity/ai';
import { fakeArticle } from './generation/fake';

// One construction for api and worker so both see the same models and fake mode.
export function createAiService(options: { anthropicKey?: string; openaiKey?: string; fake?: boolean }): AiService {
  return new AiService({
    platformKeys: { anthropic: options.anthropicKey || undefined, openai: options.openaiKey || undefined },
    fake: options.fake ? fakeArticle : undefined,
  });
}
