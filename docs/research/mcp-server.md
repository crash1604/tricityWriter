# MCP server

Sources: /docs/mcp, /docs/mcp-reference, /docs/agent-recipe, home page.

## Transport and auth

- **Remote MCP server:** one endpoint at `https://mcp.<domain>/mcp` using **Streamable HTTP**. Nothing installs on the user's machine.
- **Two ways to authenticate:**
  - **OAuth 2.1 with PKCE**, used by Claude.ai custom connectors and the ChatGPT apps directory. The user signs in with their WPWriter account, with no key needed.
  - **Bearer API key** for manual JSON config in Cursor and similar clients. Keys have a recognisable prefix (`wpw_`), are shown once, and can be listed and revoked.
- **Setup:** they publish per-client setup for about 18 clients, including one-command installs and JSON snippets.
- **Billing:** tool calls draw on the same plan quotas as the dashboard.
- **Recommended first call:** a readiness check that reports what's missing (no provider key, no site, …).

## Tool catalog (120+ tools, 17–18 categories)

Category, then approximate tool count, then representative operations. Tool *names* are listed as facts. We'll pick our own names.

| Category | # | Operations |
|---|---|---|
| Site management | 8 | list/connect sites, status/health, overview stats, test connection, read/update settings (title, tagline, timezone), set content language |
| AI content generation | 4 | generate post content (server-side AI, uses quota), improve content, generate meta description, generate+place images in content |
| Post images & media | 6 | generate featured image, upload from URL, set featured from library, swap an image in post HTML, studio product photo, 360° spin |
| Posts & pages | 19 | list/search, create, trash, publish/draft/private, schedule, read HTML, update title/excerpt/SEO/taxonomies, convert type, set homepage/blog page, activity timeline, **patch a section of content**, list/read revisions |
| WooCommerce | 6 | search/get/update products; search/get/update product categories (incl. SEO) |
| Categories & tags | 9 | CRUD both + AI-build a category structure |
| Comments | 5 | list, moderate, delete, disable/enable site comments |
| Menus | 6 | list (tree), create, add/remove item, list locations, assign location |
| SEO & rankings | 7 | per-post SEO score, site-wide SEO overview, Search Console queries, rankings, history, sync, status |
| Media library | 6 | browse, audit, update alt/title/caption, optimize |
| Auto-blogging | 6 | status, configure, add topics, trigger run, queue, history |
| Templates | 5 | CRUD for content/design/image templates |
| Analytics | 2 | monthly generation stats, generation history |
| Site identity & config | 10 | AI-generate+apply title/tagline, icon, logo, read/update Additional CSS, global prompts, list models, setup downloads |
| Site infrastructure | 12 | permalinks, install/list/activate/deactivate plugins, install themes, sidebars/widgets, page parent |
| Auth & keys | 6 | add/list/remove AI provider keys; create/list/revoke MCP keys |
| Subscription | 4 | status, upgrade link, buy pack link, usage-based recommendation |
| System | 4 | readiness, system status, **job status**, feature request |

**What the catalog shows about their design:**
- **Plugin and theme tools** only work over Application Password connections, because the connector refuses those operations.
- **Generation is async:** a job-status tool exists, so a generation runs as a job and isn't returned inline.
- **Quota split:** `create_post` with caller-supplied HTML costs **no AI credits**. Only the server-side generate and improve tools use quota.
- **Upsell inside the assistant:** subscription tools let the assistant itself sell upgrades.

## "Agent recipe" pattern

They publish a fill-in-the-blanks instruction block for a ChatGPT Agent or Claude Project. It covers site description, length and voice, structure, link rules, design, images, author, category/tag policy, and publish mode. It also tells the **assistant to write the article itself** and then chain the tools in order:

1. create the post with the full HTML
2. set taxonomies by name
3. set SEO title and description
4. featured image (generate or pick from the library)
5. optional in-article images, which need an existing post id
6. publish, draft, or schedule

The recipe also has a pre-publish self-check:
- the body is complete
- the author is set
- taxonomies and SEO are set
- the image rule was followed
- no links were invented

**Why this matters:** in MCP mode the user's assistant does the writing on the user's own chat subscription, and the platform only does the WordPress operations. That's cheap for them and free of tokens for the user.
