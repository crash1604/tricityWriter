# Implications for TriCity Writer

What the research (2026-10-26) means for the decisions in `/CLAUDE.md`.

**Status 2026-10-28:** v1 went ahead with the recommendations below. That means:
- platform keys, with credentials modelled as `platform | org`;
- plugin-only connections;
- inline-styled HTML;
- MCP split into WordPress operations and AI tools.

The project owner can still revisit any of them. Everything in "Adopt" is implemented except the deployment items (fixed egress IP, published allow-list).

## Open: decisions the research puts in question

1. **Who pays for tokens.**
   - **Our plan:** platform-held keys in v1, BYOK later. WPWriter is BYOK-first and charges for the platform, and it sells a platform-key "image pack" on the side.
   - **Consequence:** with platform keys plus multi-tenant billing, we carry token cost and have to price it (credits or markup). That's exactly what their marketing attacks.
   - **Recommendation:** model credentials as `owner = platform | org` from the first migration, so both modes are just configuration. Usage metering is needed in either case.
2. **How sites connect.**
   - **Our plan:** connector-plugin pairing only. WPWriter now *leads* with core Application Passwords (the `authorize-application.php` approval flow, with no plugin) and keeps the plugin as the fallback that adds SEO fields and gets past hosts that strip `Authorization`.
   - **Recommendation:** keep v1 plugin-only. That gives scoped access, the SEO adapters, and one code path. Keep `packages/wp-client` transport-agnostic so an Application Password transport can be added later.
3. **Output format.**
   - WPWriter emits inline-styled semantic HTML with a fixed design-pattern vocabulary. It deliberately avoids theme-owned properties, and in Gutenberg the result lands as a Classic/HTML block.
   - **Alternative:** emit Gutenberg block markup. It's native to the editor, but harder to style per post without a companion stylesheet.
   - We have to pick one before writing the generation prompts.
4. **MCP scope and quota.**
   - WPWriter splits MCP tools into WordPress operations (free when the assistant supplies the HTML) and server-side AI tools (which use quota).
   - **Recommendation:** adopt the same split. MCP v1 = connector-allowlisted content operations + generate/improve tools.

## Adopt (no decision needed, consistent with our plan)

- **REST discovery fallback:** `packages/wp-client` retries `/?rest_route=/…` when `/wp-json/…` returns HTML or a non-WordPress 404.
- **Token transport:** many hosts strip the `Authorization` header. The connector accepts its token from a custom header (`X-TCW-Token`) as well as `Authorization: Bearer`.
- **Connections:** each has a human-readable name (required at code generation) and its own token. They're listed in WP admin and revocable one at a time.
- **Unauthenticated `GET /ping`:** reports the plugin version, for diagnostics. The plain-HTTP `/status` is token-authenticated.
- **Async generation:** every generation is a job with a pollable status, used by the dashboard and MCP alike.
- **Images:** optimized server-side (resize, compress, convert format) before upload to the WP media library.
- **Linking rule** for prompts: only link to URLs supplied in context or already verified on the site. Otherwise name the resource in plain text.
- **Templates:** three kinds (content, design, image), matched by name plus the opening lines of the prompt. Per-site global content and design prompts.
- **Auto-blogging modes:** assist (draft), guarded (publish if the on-page SEO score is at or above a threshold), autopilot. This needs an on-page SEO scorer in v1, because guarded mode depends on it.
- **Deployment (later):** a fixed outbound IP, a published allowlist, and an identifying User-Agent with a contact address. Hosts and WAFs block anonymous servers.
- **Later, not v1:**
  - a public "test my site" diagnostic page
  - a separate diagnostics plugin
  - Search Console integration
  - FTP deploy
  - a starter theme

## Avoid

- Plugin/theme install and permalink changes over the connector. They tried this and backed it out.
- Direct-database mode. It's legacy for them and a large security surface.
