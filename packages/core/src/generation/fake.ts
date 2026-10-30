import type { TextRequest } from '@tricity/ai';

// Deterministic article in the format ./parse.ts expects, built from the prompt. Used with
// AI_FAKE=true so the whole pipeline (images, publishing, scoring) runs without provider keys.
export function fakeArticle(request: TextRequest): string {
  const topic = request.prompt.match(/^Topic: (.+)$/m)?.[1]?.trim() ?? 'Example topic';
  const keywords = request.prompt
    .match(/^Target keywords: ([^(\n]+)/m)?.[1]
    ?.split(',')[0]
    ?.trim();
  const keyword = (keywords || topic).toLowerCase().split(' ').slice(0, 3).join(' ');
  const words = Number(request.prompt.match(/about (\d+) words/)?.[1] ?? 800);
  const inline = Number(request.prompt.match(/Include exactly (\d+) inline image/)?.[1] ?? 0);
  const category = request.prompt.match(/Existing categories: ([^;.]+)/)?.[1]?.trim() ?? 'Guides';
  const featured = request.prompt.includes('Write a featured image prompt');

  const sentence = (i: number) =>
    `Point ${i + 1} about ${keyword} explains a practical detail readers can apply right away, with a clear example and the reasoning behind it.`;
  const sections = Math.max(3, Math.min(8, Math.round(words / 180)));
  const perSection = Math.max(2, Math.round(words / sections / 24));

  const body: string[] = [
    `<p>This guide covers ${keyword} from the ground up, so you can make confident decisions about ${topic.toLowerCase()} without wading through jargon.</p>`,
  ];
  for (let s = 0; s < sections; s++) {
    body.push(`<h2>${s === 0 ? `Why ${keyword} matters` : `${capitalize(keyword)}: part ${s + 1}`}</h2>`);
    body.push(`<p>${Array.from({ length: perSection }, (_, i) => sentence(s * perSection + i)).join(' ')}</p>`);
    if (s === 1) {
      body.push(
        '<div style="border-left:4px solid #2563eb;background:#eff6ff;padding:16px 20px;border-radius:6px;margin:24px 0"><p><strong>Tip:</strong> Start small and measure the result before scaling up.</p></div>',
      );
    }
    if (s < inline) body.push(`[[image:${s + 1}]]`);
  }

  const images = Array.from(
    { length: inline },
    (_, i) => `<image n="${i + 1}">Illustration of ${keyword}, scene ${i + 1} ||| Illustration of ${keyword}</image>`,
  ).join('\n');
  const title = `${capitalize(keyword)}: a practical guide for beginners`;

  return `<post_title>${title}</post_title>
<seo_title>${title.slice(0, 60)}</seo_title>
<meta_description>${capitalize(keyword)} explained step by step: what it is, why it matters, and how to get started today with practical tips and examples.</meta_description>
<focus_keyword>${keyword}</focus_keyword>
<excerpt>A practical introduction to ${keyword} with examples you can use today.</excerpt>
<categories>${category}</categories>
<tags>${keyword}; beginners; how to</tags>
<featured_image>${featured ? `A bright editorial photo representing ${keyword} ||| ${capitalize(keyword)}` : ''}</featured_image>
<inline_images>
${images}
</inline_images>
<post_html>
${body.join('\n')}
</post_html>`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
