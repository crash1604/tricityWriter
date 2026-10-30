import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../crypto';
import { scoreArticle } from '../seo-score';
import { normalizeSiteUrl, slugify } from '../urls';
import { fakeArticle } from './fake';
import { placeImageMarkers, resolveImagePlaceholders, sanitizeArticleHtml } from './html';
import { parseArticle } from './parse';
import { buildArticlePrompt } from './prompt';
import { generationInputSchema } from './types';

const input = generationInputSchema.parse({
  siteId: 'site-1',
  topic: 'Sourdough starter for beginners',
  keywords: 'sourdough starter, wild yeast',
  words: 900,
  inlineImages: 2,
});

describe('prompt → fake model → parse', () => {
  const { system, prompt } = buildArticlePrompt({
    input,
    siteName: 'Bread Blog',
    siteContentPrompt: 'Friendly tone.',
    siteDesignPrompt: '',
    contentTemplate: null,
    designTemplate: null,
    existingCategories: ['Baking', 'Recipes'],
    featuredImage: true,
    inlineImages: 2,
  });

  it('includes the essentials in the prompt', () => {
    expect(system).toContain('<post_html>');
    expect(prompt).toContain('Topic: Sourdough starter for beginners');
    expect(prompt).toContain('Existing categories: Baking; Recipes');
    expect(prompt).toContain('Include exactly 2 inline image(s)');
    expect(prompt).toContain('- Friendly tone.');
  });

  it('parses every section', () => {
    const article = parseArticle(fakeArticle({ system, prompt }));
    expect(article.title).toMatch(/sourdough starter/i);
    expect(article.focusKeyword).toBe('sourdough starter');
    expect(article.categories).toEqual(['Baking']);
    expect(article.tags).toContain('beginners');
    expect(article.featuredImage?.alt).toBeTruthy();
    expect([...article.inlineImages.keys()]).toEqual([1, 2]);
    expect(article.html).toContain('[[image:1]]');
  });

  it('scores a well-formed article highly', () => {
    const article = parseArticle(fakeArticle({ system, prompt }));
    const html = sanitizeArticleHtml(placeImageMarkers(article.html, article.inlineImages));
    const score = scoreArticle({ ...article, metaTitle: article.seoTitle, html, targetWords: 900 });
    const failed = score.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(score.score, `failed: ${failed.join(', ')}`).toBeGreaterThanOrEqual(80);
  });
});

describe('parseArticle', () => {
  it('rejects output without a title or body', () => {
    expect(() => parseArticle('Sorry, I cannot help with that.')).toThrow(/expected format/);
  });

  it('tolerates a missing closing body tag and dedupes lists', () => {
    const article = parseArticle('<post_title>T</post_title><tags>a; A; b</tags><post_html><p>Body</p>');
    expect(article.html).toBe('<p>Body</p>');
    expect(article.tags).toEqual(['a', 'b']);
    expect(article.seoTitle).toBe('T');
  });
});

describe('HTML handling', () => {
  it('removes scripts, event handlers and theme-owned CSS but keeps layout styles', () => {
    const html = sanitizeArticleHtml(
      '<h1>Title</h1><div style="font-family:Comic Sans;background:#eee;padding:8px" onclick="x()">' +
        '<script>alert(1)</script><p>Hi</p></div><img src="javascript:alert(1)"><a href="https://x.dev" target="_blank">x</a>',
    );
    expect(html).toBe(
      '<h2>Title</h2><div style="background:#eee;padding:8px"><p>Hi</p></div><img /><a href="https://x.dev" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('adds sizing to placeholders stored before images had a style', () => {
    expect(resolveImagePlaceholders('<img src="tcw-image://2" alt="x" />', new Map([[2, 'https://s/2.webp']]))).toBe(
      '<a href="https://s/2.webp"><img src="https://s/2.webp" alt="x" style="width:100%;height:auto" /></a>',
    );
  });

  it('drops url() in styles', () => {
    expect(sanitizeArticleHtml('<div style="background:url(https://evil.example/x.png);padding:4px">x</div>')).toBe(
      '<div style="padding:4px">x</div>',
    );
  });

  it('turns markers into image placeholders and later into linked media', () => {
    const withMarkers = '<p>A</p>\n<p>[[image:1]]</p>\n[[image:2]]\n<p>B</p>';
    const placed = sanitizeArticleHtml(placeImageMarkers(withMarkers, new Map([[1, { alt: 'One "quoted"' }]])));
    expect(placed).toContain(
      '<img src="tcw-image://1" alt="One &quot;quoted&quot;" loading="lazy" style="width:100%;height:auto" />',
    );
    expect(placed).not.toContain('image:2');

    const published = resolveImagePlaceholders(placed, new Map([[1, 'https://site/wp-content/uploads/one.webp']]));
    expect(published).toContain(
      '<a href="https://site/wp-content/uploads/one.webp"><img src="https://site/wp-content/uploads/one.webp" alt="One &quot;quoted&quot;" loading="lazy" style="width:100%;height:auto" /></a>',
    );
  });
});

describe('scoreArticle', () => {
  it('explains failures', () => {
    const score = scoreArticle({
      title: 'Short',
      metaTitle: '',
      metaDescription: 'Too short.',
      focusKeyword: 'garden tools',
      html: '<p>Nothing relevant.</p><img src="x">',
      targetWords: 1000,
    });
    expect(score.score).toBeLessThan(20);
    expect(score.checks.find((c) => c.id === 'length')?.detail).toBe('2 of 1000 words');
    expect(score.checks.find((c) => c.id === 'image-alt')?.passed).toBe(false);
  });
});

describe('utilities', () => {
  it('normalizes site URLs', () => {
    expect(normalizeSiteUrl('Example.com/')).toBe('https://example.com');
    expect(normalizeSiteUrl('http://example.com/blog/wp-admin/')).toBe('http://example.com/blog');
    expect(() => normalizeSiteUrl('ftp://example.com')).toThrow(/http/);
  });

  it('slugifies titles', () => {
    expect(slugify('Crème brûlée: 10 tips!')).toBe('creme-brulee-10-tips');
  });

  it('round-trips encrypted secrets and detects tampering', () => {
    const key = Buffer.alloc(32, 1);
    const sealed = encryptSecret('tcw_secret', key);
    expect(decryptSecret(sealed, key)).toBe('tcw_secret');
    expect(() => decryptSecret(sealed, Buffer.alloc(32, 2))).toThrow();
  });
});
