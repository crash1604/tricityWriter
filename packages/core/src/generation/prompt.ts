import type { TemplateView } from '../templates';
import type { GenerationInput } from './types';

// The response format is a fixed set of tags parsed by ./parse.ts. Keep both files in sync.
const FORMAT = `Respond with exactly these sections, in this order, and nothing outside them:

<post_title>The article headline (plain text)</post_title>
<seo_title>SEO title, 30–60 characters, containing the focus keyword</seo_title>
<meta_description>Meta description, 130–155 characters, containing the focus keyword and inviting the click</meta_description>
<focus_keyword>The single search phrase this article targets, lowercase</focus_keyword>
<excerpt>One or two plain-text sentences summarizing the article</excerpt>
<categories>Category names separated by semicolons</categories>
<tags>3–6 specific tags separated by semicolons</tags>
<featured_image>Image prompt ||| alt text</featured_image>
<inline_images>
<image n="1">Image prompt ||| alt text</image>
</inline_images>
<post_html>
The article body as HTML.
</post_html>`;

const HTML_RULES = `HTML rules for <post_html>:
- Start with an introductory paragraph, not a heading. Never include an <h1>; WordPress prints the title.
- Use <h2> for sections and <h3> for subsections, plus <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <a>, <div>, <figure> and <figcaption>.
- Styling must work with any WordPress theme. Use inline style attributes only for backgrounds, borders, border-radius, padding, margins, box-shadow, and grid/flex layout. Never set font-family, font sizes on headings, the content's max-width, base text color or link colors. Never output <style>, <script>, <iframe>, forms, classes that expect a stylesheet, or event handler attributes.
- Links: only link to URLs that appear in these instructions. Never invent a URL; mention a resource in plain text instead.
- Write in English, for humans first. No filler phrases ("In today's fast-paced world"), no claims of personal experience, no fake statistics or quotes.

Design patterns you may use when the design instructions call for them (adapt colors to the site's style):
- Callout: <div style="border-left:4px solid #2563eb;background:#eff6ff;padding:16px 20px;border-radius:6px;margin:24px 0"><p><strong>Tip:</strong> …</p></div> (warning: #d97706 on #fffbeb; success: #059669 on #ecfdf5)
- Key takeaways: <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:24px 0"><p><strong>Key takeaways</strong></p><ul>…</ul></div>
- Feature cards: <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:24px 0"> containing <div style="border:1px solid #e5e7eb;border-top:4px solid #2563eb;border-radius:10px;padding:18px">…</div> per card
- Styled table: <table style="width:100%;border-collapse:collapse;margin:24px 0"> with header cells <th style="background:#0f172a;color:#ffffff;padding:10px;text-align:left"> and body cells <td style="border-bottom:1px solid #e5e7eb;padding:10px">
- Call to action: <div style="background:#0f172a;color:#ffffff;border-radius:12px;padding:28px;margin:32px 0;text-align:center">…</div>
- Section band: wrap a section in <div style="background:#f8fafc;padding:24px;border-radius:12px;margin:24px 0"> to vary rhythm.`;

export interface PromptContext {
  input: GenerationInput;
  siteName: string;
  siteContentPrompt: string;
  siteDesignPrompt: string;
  contentTemplate: TemplateView | null;
  designTemplate: TemplateView | null;
  existingCategories: string[];
  inlineImages: number;
  featuredImage: boolean;
}

export function buildArticlePrompt(ctx: PromptContext): { system: string; prompt: string } {
  const system = [
    `You are a senior content writer and SEO editor writing for the WordPress site "${ctx.siteName}".`,
    'You produce publish-ready articles that are accurate, specific and genuinely useful.',
    FORMAT,
    HTML_RULES,
  ].join('\n\n');

  const { input } = ctx;
  const lines: string[] = [`Topic: ${input.topic}`];
  if (input.keywords.trim())
    lines.push(`Target keywords: ${input.keywords.trim()} (the first one is the focus keyword)`);
  lines.push(`Target length: about ${input.words} words in <post_html>.`);
  lines.push(`Content type: WordPress ${input.postType}.`);

  const content = [ctx.siteContentPrompt, ctx.contentTemplate?.prompt, input.instructions]
    .map((s) => s?.trim())
    .filter(Boolean);
  if (content.length) lines.push(`\nContent instructions:\n${content.map((s) => `- ${s}`).join('\n')}`);

  const design = [ctx.siteDesignPrompt, ctx.designTemplate?.prompt, input.designInstructions]
    .map((s) => s?.trim())
    .filter(Boolean);
  lines.push(
    `\nDesign instructions:\n${
      design.length
        ? design.map((s) => `- ${s}`).join('\n')
        : '- Clean layout: H2 sections, short paragraphs, lists where useful.'
    }`,
  );

  if (input.postType === 'post') {
    lines.push(
      ctx.existingCategories.length
        ? `\nExisting categories: ${ctx.existingCategories.join('; ')}. Choose one or two of these; only propose a new category if none fits at all.`
        : '\nThe site has no categories yet. Propose one short, broad category.',
    );
  } else {
    lines.push('\nThis is a page: leave <categories> and <tags> empty.');
  }

  lines.push(
    ctx.featuredImage
      ? '\nWrite a featured image prompt: a concrete visual scene that fits the article, with no text, logos or watermarks in the image.'
      : '\nNo featured image: leave <featured_image> empty.',
  );
  if (ctx.inlineImages > 0) {
    lines.push(
      `Include exactly ${ctx.inlineImages} inline image(s). Put the marker [[image:N]] on its own line in <post_html> where image N belongs (between sections, never inside a list or table), and describe each image in <inline_images>.`,
    );
  } else {
    lines.push('No inline images: leave <inline_images> empty and do not write any [[image:N]] markers.');
  }
  if (input.imageStyle.trim()) lines.push(`Image style for all prompts: ${input.imageStyle.trim()}`);

  return { system, prompt: lines.join('\n') };
}
