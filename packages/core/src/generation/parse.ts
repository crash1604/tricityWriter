import { AppError } from '../errors';

// Parses the tagged response format requested by ./prompt.ts.

export interface ParsedArticle {
  title: string;
  seoTitle: string;
  metaDescription: string;
  focusKeyword: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  featuredImage: { prompt: string; alt: string } | null;
  inlineImages: Map<number, { prompt: string; alt: string }>;
  html: string;
}

export function parseArticle(text: string): ParsedArticle {
  // The body can be long and contain anything, so take it first and parse the rest without it.
  const htmlMatch = text.match(/<post_html>([\s\S]*?)(?:<\/post_html>|$)/);
  const html = (htmlMatch?.[1] ?? '').trim();
  const rest = htmlMatch ? text.replace(htmlMatch[0], '') : text;

  const title = plain(section(rest, 'post_title'));
  if (!title || !html) {
    throw new AppError('ai_error', 'The model did not return an article in the expected format. Try again.');
  }

  const inlineImages = new Map<number, { prompt: string; alt: string }>();
  for (const match of section(rest, 'inline_images').matchAll(/<image\s+n="(\d+)"\s*>([\s\S]*?)<\/image>/g)) {
    const image = promptAndAlt(match[2] ?? '');
    if (image) inlineImages.set(Number(match[1]), image);
  }

  return {
    title,
    seoTitle: plain(section(rest, 'seo_title')) || title,
    metaDescription: plain(section(rest, 'meta_description')),
    focusKeyword: plain(section(rest, 'focus_keyword')).toLowerCase(),
    excerpt: plain(section(rest, 'excerpt')),
    categories: list(section(rest, 'categories')).slice(0, 3),
    tags: list(section(rest, 'tags')).slice(0, 8),
    featuredImage: promptAndAlt(section(rest, 'featured_image')),
    inlineImages,
    html,
  };
}

function section(text: string, tag: string): string {
  return text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';
}

function plain(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function list(value: string): string[] {
  const seen = new Set<string>();
  return plain(value)
    .split(/[;\n]/)
    .map((s) => s.trim().replace(/^#/, ''))
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || s.length > 60 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function promptAndAlt(value: string): { prompt: string; alt: string } | null {
  const [prompt, alt] = plain(value)
    .split('|||')
    .map((s) => s.trim());
  if (!prompt) return null;
  return { prompt, alt: alt || prompt.slice(0, 120) };
}
