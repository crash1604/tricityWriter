import sanitizeHtml from 'sanitize-html';

// Generated HTML goes into post_content of users who usually have unfiltered_html, so it is
// sanitized here; WordPress' own kses only runs for less-privileged users.

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'mark',
  'small',
  'sub',
  'sup',
  'code',
  'pre',
  'blockquote',
  'cite',
  'q',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'div',
  'span',
  'section',
  'details',
  'summary',
  'abbr',
  'time',
];

// Theme-owned properties are dropped so generated content never fights the theme.
const BLOCKED_CSS = /^(font-family|max-width|position|z-index|behavior|-moz-binding)$/i;

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['style', 'title', 'id'],
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    ol: ['start', 'type'],
    time: ['datetime'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'tcw-image'] },
  allowProtocolRelative: false,
  transformTags: {
    // WordPress prints the title as the page's h1.
    h1: 'h2',
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
    }),
  },
};

export function sanitizeArticleHtml(html: string): string {
  const cleaned = sanitizeHtml(html, SANITIZE);
  // sanitize-html keeps style attributes verbatim; filter individual declarations here.
  return cleaned.replace(/ style="([^"]*)"/g, (_, css: string) => {
    const kept = css
      .split(';')
      .map((d) => d.trim())
      .filter((d) => {
        const [prop, ...value] = d.split(':');
        if (!prop || value.length === 0) return false;
        const v = value.join(':');
        // Backslashes would let CSS escapes (\75 rl( = url() slip past the checks; articles never need them.
        return !BLOCKED_CSS.test(prop.trim()) && !/url\s*\(|expression\s*\(|javascript:|\\/i.test(v);
      });
    return kept.length ? ` style="${kept.join(';')}"` : '';
  });
}

// Themes don't constrain images in raw HTML content, and full-size images are wider than any content
// column, so inline images scale to their container.
const IMAGE_STYLE = 'width:100%;height:auto';

// Replaces [[image:N]] markers with placeholders for the images we actually have; markers without an
// image are removed.
export function placeImageMarkers(html: string, images: Map<number, { alt: string }>): string {
  return html.replace(/(?:<p>\s*)?\[\[image:(\d+)\]\](?:\s*<\/p>)?/g, (_, n: string) => {
    const image = images.get(Number(n));
    if (!image) return '';
    return `<figure style="margin:28px 0"><img src="tcw-image://${n}" alt="${escapeAttr(image.alt)}" loading="lazy" style="${IMAGE_STYLE}" /></figure>`;
  });
}

// At publish time: point placeholders at uploaded media, linked to the full-size file so lightbox
// plugins pick them up.
export function resolveImagePlaceholders(html: string, urls: Map<number, string>): string {
  return html.replace(/<img src="tcw-image:\/\/(\d+)"([^>]*?)\s*\/?>/g, (_, n: string, rest: string) => {
    const url = urls.get(Number(n));
    if (!url) return '';
    const attributes = /\sstyle="/.test(rest) ? rest.trimEnd() : `${rest.trimEnd()} style="${IMAGE_STYLE}"`;
    return `<a href="${escapeAttr(url)}"><img src="${escapeAttr(url)}"${attributes} /></a>`;
  });
}

// For previews in the dashboard: placeholders point at the API's image endpoint.
export function previewImagePlaceholders(html: string, urlFor: (slot: number) => string): string {
  return html.replace(/src="tcw-image:\/\/(\d+)"/g, (_, n: string) => `src="${escapeAttr(urlFor(Number(n)))}"`);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
