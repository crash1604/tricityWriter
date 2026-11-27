import type { ModelSpec } from './types';

// The models offered in the dashboard and MCP. Prices are list prices (checked 2026-11-18) used for the
// usage/cost estimate and the per-workspace platform budget. Image prices are OpenAI's per-image figures
// for medium quality at 1536x1024, the only size and quality the pipeline requests.
export const DEFAULT_MODELS: readonly ModelSpec[] = [
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    kind: 'text',
    providerModel: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'Highest writing quality; best default for articles.',
    pricing: { inputPerMTok: 4, outputPerMTok: 20 },
    effort: 'high',
    fallbacks: true,
    default: true,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    kind: 'text',
    providerModel: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Fast and strong; good for high-volume auto-blogging.',
    pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    effort: 'high',
    fallbacks: true,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    kind: 'text',
    providerModel: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    description: 'Cheapest; fine for short drafts and meta descriptions.',
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
    effort: 'medium',
  },
  {
    id: 'gpt-5.5',
    provider: 'openai',
    kind: 'text',
    providerModel: 'gpt-5.5',
    label: 'GPT-5.5',
    description: "OpenAI's flagship model.",
    pricing: { inputPerMTok: 5, outputPerMTok: 30 },
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    kind: 'text',
    providerModel: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: 'Balanced cost and quality.',
    pricing: { inputPerMTok: 0.75, outputPerMTok: 4.5 },
  },
  {
    id: 'gpt-image-2',
    provider: 'openai',
    kind: 'image',
    providerModel: 'gpt-image-2',
    label: 'GPT Image 2',
    description: 'High-quality photorealistic and illustrated images.',
    pricing: { perImage: 0.041 },
    default: true,
  },
  {
    id: 'gpt-image-1-mini',
    provider: 'openai',
    kind: 'image',
    providerModel: 'gpt-image-1-mini',
    label: 'GPT Image 1 mini',
    description: 'Cheaper, faster images.',
    // Estimated from its per-token rate ($8 per 1M image output tokens).
    pricing: { perImage: 0.013 },
  },
];
