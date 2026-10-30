import { invalid } from './errors';

// Canonical form of a site address as entered by a user: http(s), no query/fragment, no trailing
// slash. A subdirectory install keeps its path (https://example.com/blog).
export function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid('Enter the site address, like https://example.com.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw invalid('Site address must start with http or https.');
  if (url.username || url.password) throw invalid('Site address must not contain credentials.');

  const path = url.pathname.replace(/\/(wp-admin|wp-login\.php|wp-json)(\/.*)?$/, '').replace(/\/+$/, '');
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}

export function slugify(value: string, max = 60): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'item'
  );
}
