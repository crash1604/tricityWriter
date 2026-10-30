# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**v1 built 2026-10-28.** Working end to end, checked in a browser against WordPress Playground with `AI_FAKE=true`:

- sign-up with a workspace
- site pairing
- the 4-step wizard → review/edit → publish/update/schedule
- SEO meta via Yoast, Rank Math or AIOSEO, or our own head tags
- auto-blogging with schedules and policies
- MCP over HTTP with bearer keys
- usage metering

**Not yet run:** real Anthropic and OpenAI calls. The adapters are written and typecheck against the SDKs, but no keys have been used.

**Deferred:** see the Decisions section below, plus:

- MCP OAuth (only bearer keys exist)
- workspace invitations UI
- billing
- per-org keys

If a decision changes, update this file in the same change.

## What this is

**TriCity Writer** is a clean-room rebuild of the product category that **WPWriter** (wpwriter.com) belongs to. It's a multi-tenant SaaS that generates SEO content with AI and publishes it to self-hosted WordPress sites. Each site runs a thin **connector plugin** that the backend talks to.

### Clean-room rule (strict)

- **Never** download, open, decompile, or grep the code of:
  - the WPWriter connector plugin (`ylabs-connector-for-wpwriter` on WordPress.org)
  - wpwriter.com's JS bundles
  - AI WP Writer (`ai-wp-writer`), an unrelated plugin with a similar name

  That includes WebFetch/curl of their `.js`/`.php` files, browsing their plugin SVN/Trac, and their plugin and theme ZIPs.
- **Allowed sources:**
  - public marketing, docs, and blog pages
  - WordPress.org listing text (description, FAQ, changelog, screenshots)
  - behavior seen as a user of the running product
- Record each finding about the reference product in `docs/research/` with its source URL. Never copy their prompts, templates, UI copy, or text verbatim.
- Keep "WPWriter" and "wp-writer" out of our names, slugs, and UI. It's the competitor's brand.
- wpwriter.com is a client-rendered SPA, so WebFetch/curl returns only the `<title>`. Read its pages (the list is in `/sitemap.xml`) by rendering them in a real browser (Claude in Chrome).

The research lives in `docs/research/`, starting at `README.md`. `implications.md` there records which of its suggestions we adopted.

## Decisions

| Area | Choice |
|---|---|
| Shape | Next.js dashboard + Fastify API (REST + MCP) + BullMQ worker, plus a PHP connector plugin on each WP site |
| Repo | pnpm workspaces + Turborepo monorepo |
| Data | Postgres + Drizzle; Redis for BullMQ |
| Auth / tenancy | Better Auth with the organization plugin; **organizations = tenants**. Each sign-up gets its own workspace |
| AI keys | Platform-held Anthropic + OpenAI keys (v1). `usage_events.credential_owner` already distinguishes `platform`/`org` for BYOK later |
| Models | Claude Opus 5.5 is the default writer (also Sonnet 5.5, Haiku 5.5, GPT-5.5, GPT-5.4 mini). Images use GPT Image 2 / GPT Image 1 mini |
| Connecting sites | Connector plugin only, with pairing codes. Application Password connections are deferred |
| Output | Sanitized semantic HTML with theme-safe inline styles (see `generation/prompt.ts`), stored in classic `post_content` |
| Connector compat | WordPress 6.0+, PHP 7.4+ |
| Language | English only (content and UI) |
| Local | WordPress Playground CLI (no Docker); Homebrew Postgres 18 + Redis |
| Tooling | TypeScript 7 (native `tsc`), Biome, Vitest, tsup, Tailwind v4, TanStack Query |

**Deferred:**
- rewriting/improving existing posts
- WooCommerce
- menus, widgets, site settings
- Search Console
- per-org keys
- billing
- i18n/RTL
- analytics UI

## Architecture

```
apps/web         Next.js dashboard; /api/* and /mcp are rewritten to apps/api (cookies stay first-party)
apps/api         Fastify: Better Auth at /api/auth/*, session-guarded REST at /api/v1/*, MCP at /mcp
apps/worker      BullMQ consumers (generate, publish, autoblog-run); re-registers schedules on start
packages/core    Domain services used by api, MCP and worker: sites, posts, templates, generation
                 pipeline, auto-blogging, MCP keys, usage. Also `@tricity/core/testing` (fake WordPress, fake AI)
packages/db      Drizzle schema (incl. generated Better Auth tables), migrations, forOrg() data access
packages/ai      AiService: model registry, Anthropic/OpenAI/fake providers, usage + cost records
packages/jobs    BullMQ JobQueue implementation and per-site job schedulers
packages/shared  Zod contracts: connector API, queue/job payloads; `/env` = server-only .env loader
packages/wp-client  ConnectorClient: the only code that calls WordPress sites
plugins/tricity-writer   PHP connector plugin (not a pnpm workspace)
```

### Invariants that span packages

- **Tenant scoping:** every tenant-owned table has `org_id`. All access goes through `forOrg(db, orgId)` in `packages/db/src/tenant.ts`. The only cross-tenant lookups are in its `system` object, and each says why.
- **Validate ids first:** ids from callers are checked with `isUuid()` (`packages/core/src/ids.ts`) before any query, because a malformed uuid is a Postgres error, not a 404.
- **One path to AI:** only `packages/ai` imports provider SDKs. Callers pass a usage sink, and core records every call in `usage_events` with org, site and generation.
- **One path to WordPress:** only `ConnectorClient` talks to sites. Core wraps it in `withSite()`, which marks the site `disconnected` when the token is rejected.
- **Connector contract:** defined in `packages/shared/src/connector.ts` and mirrored by `plugins/tricity-writer/src/Rest/*`. Change both together. All writes use POST, because hosts and WAFs block PUT/PATCH/DELETE.
- **REST and MCP share core:** they call the same core functions; MCP adds nothing of its own. HTML from assistants is sanitized with `sanitizeArticleHtml` like generated HTML.
- **Errors:** core throws `AppError` with user-safe messages and an HTTP status. `toAppError()` maps `ConnectorError` and `AiError`. Anything else is a 500.

### Key flows

1. **Pairing:** a WP admin generates a single-use code (10-minute expiry, stored hashed in an option). The dashboard posts the URL and code, the API calls the plugin's `/pair`, and stores the returned token AES-GCM encrypted (`ENCRYPTION_KEY`). The plugin stores only a hash of the token.
2. **Generation** (`packages/core/src/generation/pipeline.ts`): status runs `queued → generating → ready → publishing → published`, or `failed`.
   1. **Prompt:** built from the site's global prompts, a content template, a design template and the user's instructions.
   2. **Text:** the model answers in a tagged format (`<post_title>`, …, `<post_html>`), parsed by `parse.ts`. The prompt and parser must stay in sync.
   3. **Images:** slot 0 is the featured image and 1..n are inline. Inline images are `[[image:N]]` markers, which become `tcw-image://N` placeholders. Images are optimized to WebP with sharp and stored in `generation_images` until publish.
   4. **Review:** "ready" articles can be previewed (placeholders point at the API's image endpoint), edited and re-scored.
   5. **Publish:** uploads any images not yet uploaded, rewrites the placeholders to the uploaded media URLs, creates the post (or updates it on republish), then writes SEO fields.
3. **Auto-blogging:**
   - Each site has a profile with an assist, guarded or autopilot policy, a cron schedule and a time zone, plus a topic queue.
   - `saveAutoblog` upserts a BullMQ job scheduler `autoblog:<siteId>`.
   - Each run claims the oldest queued topic (`FOR UPDATE SKIP LOCKED`) and runs the same pipeline.
   - Guarded mode publishes only if the SEO score is at or above the threshold (`seo-score.ts`); otherwise it saves a draft and adds a warning.
4. **SEO meta** (`plugins/tricity-writer/src/Seo.php`):
   - **Yoast:** `_yoast_wpseo_*` post meta.
   - **Rank Math:** `rank_math_*` post meta.
   - **AIOSEO:** its `Models\Post` (own table) plus `_aioseo_*` meta.
   - **No SEO plugin:** our `_tcw_seo_*` meta, printed as a `<meta name="description">` and the document title.
5. **MCP:**
   - Keys: `tcw_mcp_…` bearer keys, stored as SHA-256 and created in Settings.
   - Server: stateless Streamable HTTP with JSON responses.
   - Tools: 19, listed in `apps/api/src/mcp.ts`. `create_post` costs no AI credits; `generate_article` queues a job.

## Connector plugin conventions (`plugins/tricity-writer`)

- **Names:**
  - slug and text domain `tricity-writer`
  - PHP namespace `TricityWriter` (PSR-4 under `src/`, loaded by the plugin's own autoloader)
  - prefix `tcw_`
  - REST namespace `tricity-writer/v1`
- **PHP 7.4 syntax only.** No `match`, enums, `readonly`, named arguments, constructor promotion, union types, or nullsafe `?->`.
- **WordPress 6.0 APIs only.**
- **Slash before writing:** `wp_insert_post`, `wp_update_post` and `update_post_meta` expect slashed data, so wrap the values in `wp_slash()`.
- **Capabilities:** checked per operation in the handlers, not only in `Auth::check()`.
- **Media uploads:** verify the real file type with `wp_get_image_mime()` and delete the file on mismatch.
- **Never cache plugin responses:** `Routes::no_cache` sets the headers for every plugin route.

## Commands

Run these from the repo root. Prerequisites:
- Postgres and Redis running as brew services
- databases `tricity_writer` and `tricity_writer_test`
- `cp .env.example .env`, then fill in `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` (each from `openssl rand -base64 32`)

```sh
pnpm install
pnpm db:migrate              # apply migrations to DATABASE_URL (pnpm db:generate after schema edits)
pnpm wp:dev                  # WordPress Playground + plugin, PHP 7.4, http://127.0.0.1:9400 (admin / password)
pnpm dev                     # web :3000, api :4000, worker
pnpm build | pnpm typecheck | pnpm test | pnpm lint (pnpm format to fix)

pnpm --filter @tricity/core test src/generation/generation.test.ts   # one test file
pnpm --filter @tricity/api test -t "MCP"                              # tests matching a name
pnpm --filter @tricity/core e2e:connector [--seo=yoast|rankmath|aioseo] [--php=8.3]
                             # plugin e2e against a throwaway Playground site (needs network for SEO plugins)
```

`AI_FAKE=true` in `.env` serves every AI call from the built-in fake: placeholder articles and SVG images, with cost 0. Set it to `false` and fill in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for real generation.

## Workspace conventions and gotchas

- **Internal packages:** `packages/*` export TypeScript source and have no build step.
  - tsup bundles them into the API and worker (`noExternal: [/^@tricity\//]` in `tsup.config.ts`; tsup 9's `--no-external` flag is broken).
  - `apps/web` does not import workspace packages: its API types live in `apps/web/lib/api.ts`. Keep them in sync with `apps/api/src/routes/*`.
- **Next.js page files:** they may only export the page component. Shared UI goes in `apps/web/components/`.
- **Better Auth:**
  - Tables are generated with `pnpm dlx auth@<better-auth version> generate --config apps/api/auth.cli.ts --output packages/db/src/auth-schema.ts`. `@better-auth/cli` is the old CLI and lags behind.
  - The sign-up session is created before the new user's workspace exists, so `requireSession` activates the first membership when `activeOrganizationId` is null.
- **BullMQ 6:** pass a constructed `ioredis` client with `maxRetriesPerRequest: null` (see `createRedis` in `packages/jobs`).
- **Integration tests:** suites in `db`, `core` and `api` use `TEST_DATABASE_URL`, are skipped when it's unset, and run in parallel.
  - Use unique org ids per suite and never truncate tables.
  - Migrations take a Postgres advisory lock (`migrateDatabase`).
- **Images in posts:** inline `<img>` tags need `style="width:100%;height:auto"`. Themes don't constrain raw-HTML images, so without it they overflow the content column (seen on Twenty Twenty-Five).
- **Playground:**
  - `wp:dev` uses `--no-login`. Auto-login 302-redirects every cookieless request, including our server-to-server REST calls.
  - Rank Math prints no head tags under Playground, so the e2e skips that one check. Its `Helper::get_post_meta()` reads our keys.
- **Plugin PHP lint is unverified:** `composer.json` and `phpcs.xml.dist` exist, but PHP isn't installed (`brew install php composer`). Playground on PHP 7.4 is the runtime check.
- **pnpm build scripts:** new dependency build scripts must be allowed under `allowBuilds` in `pnpm-workspace.yaml`.
- **`packages/ai`:** use the `claude-api` skill for current Anthropic model IDs and SDK usage. Opus/Sonnet calls stream, set `output_config.effort`, and send `fallbacks: 'default'` with the `server-side-fallback-2026-07-01` beta.
