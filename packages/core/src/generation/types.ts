import { postTypeSchema } from '@tricity/shared';
import { z } from 'zod';
import type { SeoScore } from '../seo-score';

// Options shared by the wizard, auto-blogging profiles and MCP's generate tool.
export const generationOptionsSchema = z.object({
  words: z.number().int().min(300).max(5000).default(1200),
  // A template id: "builtin:<slug>" or a custom template's uuid.
  contentTemplateId: z.string().optional(),
  designTemplateId: z.string().optional(),
  // Extra instructions for this article (phase 1: what to say).
  instructions: z.string().max(4000).default(''),
  // Extra instructions for this article (phase 2: how it looks).
  designInstructions: z.string().max(4000).default(''),
  textModel: z.string().optional(),
  imageModel: z.string().optional(),
  featuredImage: z.boolean().default(true),
  inlineImages: z.number().int().min(0).max(6).default(0),
  // Visual style appended to every image prompt (phase 3).
  imageStyle: z.string().max(500).default(''),
  postType: postTypeSchema.default('post'),
});
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const deliverySchema = z.discriminatedUnion('mode', [
  // Stop when the article is ready; a person reviews and publishes it.
  z.object({ mode: z.literal('review') }),
  // Push to WordPress right away with this status.
  z.object({
    mode: z.literal('publish'),
    status: z.enum(['draft', 'publish', 'future']),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
  }),
  // Auto-blogging: the publish status depends on the policy and the SEO score.
  z.object({
    mode: z.literal('autoblog'),
    policy: z.enum(['assist', 'guarded', 'autopilot']),
    threshold: z.number().int().min(0).max(100),
    topicId: z.string(),
  }),
]);
export type Delivery = z.infer<typeof deliverySchema>;

export const generationInputSchema = generationOptionsSchema.extend({
  siteId: z.string(),
  topic: z.string().trim().min(3).max(300),
  keywords: z.string().max(500).default(''),
  delivery: deliverySchema.default({ mode: 'review' }),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationRequest = z.input<typeof generationInputSchema>;

export interface GeneratedImageSlot {
  // 0 = featured; 1..n = inline, matching tcw-image://n in the HTML.
  slot: number;
  prompt: string;
  alt: string;
}

export interface GenerationOutput {
  title: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  // Sanitized HTML; inline images reference tcw-image://<slot> until publishing.
  html: string;
  images: GeneratedImageSlot[];
  seo: SeoScore;
  textModel: string;
  imageModel: string | null;
  warnings: string[];
}
