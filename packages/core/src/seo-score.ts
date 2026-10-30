// On-page SEO checks for a generated article. Auto-blogging's "guarded" mode publishes only when
// the score reaches the profile's threshold, so keep these deterministic and explainable.

export interface SeoCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface SeoScore {
  score: number;
  checks: SeoCheck[];
}

export interface SeoInput {
  title: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  html: string;
  targetWords: number;
}

export function scoreArticle(input: SeoInput): SeoScore {
  const keyword = normalize(input.focusKeyword);
  const text = normalize(htmlToText(input.html));
  const words = text ? text.split(' ').length : 0;
  const firstParagraph = normalize(htmlToText(input.html.match(/<p[\s>][\s\S]*?<\/p>/i)?.[0] ?? ''));
  const h2s = [...input.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => normalize(htmlToText(m[1] ?? '')));
  const images = [...input.html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const occurrences = keyword ? countOccurrences(text, keyword) : 0;
  const density = words ? (occurrences * keyword.split(' ').length * 100) / words : 0;
  const titleLength = (input.metaTitle || input.title).length;
  const descriptionLength = input.metaDescription.length;

  const checks: SeoCheck[] = [
    check('keyword', 'Focus keyword is set', 5, keyword.length > 0, keyword || 'missing'),
    check('title-keyword', 'Keyword appears in the title', 15, has(input.metaTitle || input.title, keyword), ''),
    check(
      'title-length',
      'SEO title is 30–65 characters',
      10,
      titleLength >= 30 && titleLength <= 65,
      `${titleLength}`,
    ),
    check(
      'description-length',
      'Meta description is 120–160 characters',
      10,
      descriptionLength >= 120 && descriptionLength <= 160,
      `${descriptionLength}`,
    ),
    check(
      'description-keyword',
      'Keyword appears in the meta description',
      10,
      has(input.metaDescription, keyword),
      '',
    ),
    check('intro-keyword', 'Keyword appears in the first paragraph', 10, has(firstParagraph, keyword), ''),
    check(
      'heading-keyword',
      'Keyword appears in a subheading',
      10,
      h2s.some((h) => has(h, keyword)),
      '',
    ),
    check('headings', 'At least two H2 subheadings', 5, h2s.length >= 2, `${h2s.length}`),
    check(
      'length',
      'Length reaches 90% of the target',
      15,
      words >= Math.floor(input.targetWords * 0.9),
      `${words} of ${input.targetWords} words`,
    ),
    check('density', 'Keyword density is 0.5–3%', 5, density >= 0.5 && density <= 3, `${density.toFixed(1)}%`),
    check(
      'image-alt',
      'Every image has alt text',
      5,
      images.every((img) => /\balt="[^"]+"/i.test(img)),
      `${images.length} images`,
    ),
  ];

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  return { score: Math.round((earned * 100) / total), checks };
}

function check(id: string, label: string, weight: number, passed: boolean, detail: string): SeoCheck {
  return { id, label, weight, passed, detail };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:#\d+|[a-z]+);/gi, ' ');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function has(haystack: string, keyword: string): boolean {
  return keyword.length > 0 && ` ${normalize(haystack)} `.includes(` ${keyword} `);
}

function countOccurrences(text: string, keyword: string): number {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`(?<=^| )${escaped}(?= |$)`, 'g'))?.length ?? 0;
}

export function countWords(html: string): number {
  const text = normalize(htmlToText(html));
  return text ? text.split(' ').length : 0;
}
