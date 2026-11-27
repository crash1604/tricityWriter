// The platform release. Shown by /health and MCP, and sent to WordPress sites in the User-Agent.
export const VERSION = '1.0.0';

// Identifies our traffic to hosts and WAFs, with the dashboard address as the contact point, so site
// owners can recognise and allow-list it.
export function userAgent(origin: string): string {
  return `TriCityWriter/${VERSION} (+${origin.replace(/\/+$/, '')})`;
}
