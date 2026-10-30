# Site connection and connector plugin

## Two connection methods

| | One-step connect (now **recommended**) | Connector plugin (now **fallback**) |
|---|---|---|
| How | User asks their AI assistant to connect a site. The assistant returns a link to the site's **`/wp-admin/authorize-application.php`**, the core WordPress Application Password approval screen. The owner clicks "Yes, I approve" in their own browser. | Install the plugin, open its admin page, enter a **connection name** (required), and generate a **pairing code**. Paste the URL and code into the assistant or the dashboard's "Add Site". |
| Credential | Core Application Password; calls go to core `/wp/v2` | Plugin token, sent on every request |
| Needs | HTTPS, Application Passwords enabled, permalinks not "Plain" | WordPress 4.7+ (docs) / 5.6+ (listing) |
| Extras | Full core REST access with the approving user's role, so plugins, themes, permalinks, and so on are reachable | Built-in Yoast / Rank Math / AIOSEO field support. Works on hosts that strip the `Authorization` header (a common cause of 401s). |

Sources: /docs/requirements, /docs/connect-wordpress, /docs/mcp, /egress-ips.

## Connector plugin behaviour (listing + docs)

- **Pairing codes:** single-use and expire after 10 minutes. They're tied to the WP user who generates them, so the docs advise using an account that can edit posts and pages. Codes are stored in the DB rather than the object cache (changelog 1.12.3).
- **Pairing call:** the server sends one `POST /wp-json/wp-manager/v1/pair` from its fixed egress IP. If the response is HTML or a non-WordPress 404, it retries once via `/?rest_route=/wp-manager/v1/pair`.
- **Namespaces:** `wp-writer/v1` (current) and `wp-manager/v1` (legacy).
- **Known routes:**
  - `GET …/ping` (unauthenticated, used by diagnostics)
  - `POST …/pair`
  - `GET …/status` (token-authenticated health check)
  - a REST proxy that forwards only allowlisted core and WooCommerce requests
- **Connections:** a site can have several, each with its own name and token. They're listed in WP admin and can be revoked one at a time. Deactivating the plugin keeps connections. Deleting it removes all of its data.
- **Scope (v1.15):** content operations only, enforced on every request even for admins.
  - **Allowed:** posts/pages CRUD and scheduling, media upload/edit, categories/tags, comments, menus and locations, widgets, full HTML in content, reading the theme and SEO plugin, writing SEO fields, WooCommerce products, and 14 display settings (writes need an Administrator pairing).
  - **Refused:** plugins, themes, core updates, users/roles, other settings, secrets, file edits, unfiltered uploads, import/export.
- **Caching:** all plugin routes are marked uncacheable, with LiteSpeed called out specifically.
- **Changelog history:**
  - The connector briefly re-enabled Application Passwords on its own, then stopped (1.12.2 → 1.14.0).
  - It once had plugin, theme, and permalink endpoints and an "AI key reader", all removed later.
  - Takeaway: the scope **narrowed** over time, probably because of WordPress.org review or security concerns.

## Network behaviour (egress-ips page)

- **Egress IP:** all outbound traffic leaves from **one fixed IPv4 address**, published with a machine-readable list at `api.wpwriter.com/ips.txt`. Changes are announced 10 or more days ahead, so hosts can allowlist it. Their docs include allowlisting steps for Imunify360, Cloudflare (Bot Fight Mode can't be bypassed by WAF rules), Wordfence, and Sucuri.
- **User-Agent:** identifies the product and gives a contact, e.g. `Product/1.0 (+url; support email)`.
- **REST paths used:**
  - `/wp-json/wp/v2/*`
  - the plugin namespaces
  - `/wp-json/wc/v3/*` on WooCommerce sites

  Application Password connections fall back to `/?rest_route=` when `/wp-json/` returns HTML. Established plugin connections use `/wp-json/` only.
- **Unauthenticated discovery:** on first connect, a `GET /wp-json/` plus a few `/wp/v2` probes.
- **Public "test connection" diagnostic:** anonymous and rate-limited. It checks:
  - REST reachability
  - whether the plugin is installed (via ping)
  - a pair attempt with a dummy code, to detect a host blocking POSTs
  - `users/me`

  Each failure comes with a specific fix. They also offer a separate **diagnostics plugin** that checks internal REST routes, security plugins, and REST-blocking hooks, and produces a copyable report with no secrets in it.
- **Follow-up after a failed connect:** the system re-runs the diagnostic later, before emailing the person about it.
- **Public page reads:**
  - fetches the post's public URL to read its rendered SEO meta
  - runs broken-link scans with HEAD requests (sometimes a small ranged GET)
  - fetches media from `/wp-content/uploads/*`
- **Background jobs:** reads recent posts shortly after connect (to choose onboarding tips), and reads posts and categories for post-idea emails.
- **Optional extra modes:**
  - **FTP/FTPS deploy**, passive mode, using the host and port the customer enters
  - **direct MySQL connection** (legacy "advanced" mode) using DB credentials the customer enters
- **Typical load:** about 12 requests per site per hour during an active session.

## Setup guidance they give users

- The site URL must match exactly, including `www` or no `www`.
- When REST routes 404, re-save Permalinks to flush rewrite rules. They recommend the "Post name" structure.
