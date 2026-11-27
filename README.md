# TriCity Writer

TriCity Writer writes SEO articles with AI and publishes them to self-hosted WordPress sites. You run it on your own server. Each WordPress site installs a small connector plugin, and your team writes, reviews and publishes from one dashboard. Assistants like Claude and ChatGPT can do the same over MCP.

Version 1.0.0. English only.

## Features

- **Article wizard:** topic and keywords in; title, HTML body, SEO title, meta description, categories, tags, a featured image and inline images out. You can stop for review or send it straight to WordPress as a draft.
- **Review and publish:** preview, edit the HTML and SEO fields, and check a built-in 0–100 SEO score. Then publish, schedule or save as a draft, and update the same post later.
- **Templates and site prompts:** built-in and custom content and design templates, plus per-site instructions for voice, audience and brand colors.
- **Auto-blogging:** a topic queue per site, written on a schedule (presets or cron, in your time zone). It can save drafts, publish only above an SEO score, or always publish.
- **SEO plugins:** writes Yoast, Rank Math or All in One SEO fields, or prints its own title and meta description when no SEO plugin is installed.
- **Teams:** several workspaces per account, owner/admin/member roles, and invitation links.
- **AI models:** Claude Opus 5.5 (default), Sonnet 5.5 and Haiku 5.5; GPT-5.5 and GPT-5.4 mini; GPT Image 2 and GPT Image 1 mini for images. Workspaces can bring their own Anthropic and OpenAI keys.
- **Cost controls:** usage metering per model, an optional monthly budget for the server's AI keys, and a cap on articles in progress.
- **AI assistants (MCP):** 19 tools for sites, posts, SEO, templates, articles and auto-blogging. Assistants connect with an API key, or by signing in (OAuth) when the server uses HTTPS.
- **Connector plugin:** pairs with a one-time code and needs no Application Passwords. It updates itself from your dashboard.

The [user manual](docs/user-manual.md) explains every feature step by step.

## How it works

```
                ┌──────────────────────── your server ────────────────────────┐
browser / MCP ─►│ Caddy (HTTPS) ─┬─► web: Next.js dashboard                    │
                │                └─► api: REST, auth, MCP ──┬─► Postgres       │
                │                    worker: AI jobs ───────┴─► Redis          │
                └──────────────────────────────┬──────────────────────────────┘
                                               ▼ HTTPS + connection token
                                 WordPress sites with the connector plugin
```

The worker calls Anthropic and OpenAI, optimizes images to WebP, and publishes through the connector's REST API. Site tokens and AI keys are stored encrypted. Calls to WordPress refuse private and reserved network addresses.

## Deploy

You need:

- **A server:** Ubuntu 24.04 with root SSH access, at least 2 vCPU, 4 GB RAM and 40 GB disk. A GoDaddy VPS works, as does any other provider.
- **A domain** pointing at the server, for HTTPS. Optional for a first try.
- **On your computer:** this repository, plus `bash`, `ssh` and `rsync`.
- **AI keys:** an Anthropic key (writing) and an OpenAI key (images and GPT models). They can be set server-wide, or added by each workspace in the dashboard.

```sh
git clone https://github.com/crash1604/tricityWriter.git
cd tricityWriter
git checkout teams-oauth-byok-deploy               # the 1.0.0 release

ssh root@SERVER_IP 'bash -s' < deploy/bootstrap-vps.sh   # once per server: Docker, firewall, swap, backups
deploy/deploy.sh root@SERVER_IP app.example.com          # build and start (omit the domain to use the IP)
```

The first deploy generates the server's secrets in `/opt/tricity/deploy/.env` and takes 5–15 minutes to build. Running `deploy/deploy.sh` again updates the code and keeps that file. Afterwards:

1. Check `https://app.example.com/health`. It returns `{"ok":true,"version":"1.0.0"}`.
2. Open the dashboard and create the first account straight away. New servers are invite-only, and the first account can always sign up.
3. Add AI keys, under **Settings → AI keys** or in `deploy/.env`.
4. Connect a WordPress site: **Sites → Connect a site**.

The full guide is [docs/deploy-godaddy.md](docs/deploy-godaddy.md). It covers server setup, DNS, configuration, backups, updates and troubleshooting, plus a checklist for before you open sign-ups.

> Never change `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` or `POSTGRES_PASSWORD` on a live server. They protect the OAuth signing keys, stored site tokens and AI keys, and the database.

### Main settings (`deploy/.env`)

| Setting | Default | What it does |
|---|---|---|
| `SITE_ADDRESS`, `WEB_ORIGIN` | the domain given to `deploy.sh`, else plain HTTP on the IP | Public address; set both when you add a domain later |
| `SIGNUP_MODE` | `invite` | `invite`: the first account and invited people only. `open`: anyone |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | empty | Server-wide AI keys for workspaces without their own |
| `ALLOW_PLATFORM_KEYS` | `true` | `false` makes every workspace bring its own keys |
| `PLATFORM_MONTHLY_BUDGET_USD` | `5` | Monthly spend per account on the server-wide keys; empty for no cap |
| `MAX_ACTIVE_GENERATIONS` | `20` | Articles one workspace may have queued or writing at once |
| `EMAIL_PROVIDER` | `none` | `resend` sends invitations, resets and confirmations; `none` writes them to the log |
| `AI_FAKE` | `false` | `true` serves placeholder articles at no cost, for a dry run |

## WordPress connector

- **Requirements:** WordPress 6.0 or later, PHP 7.4 or later.
- **Install:** download the zip from the dashboard (**Sites → Connect a site**), then upload it under **Plugins → Add New → Upload Plugin**.
- **Pair:** generate a pairing code under **TriCity Writer** in WordPress admin and paste it into the dashboard. Codes are single-use and expire after 10 minutes. The plugin stores only a hash of its connection token.
- **Updates:** they appear in WordPress like any other plugin update, and an administrator installs them.

The source is in [`plugins/tricity-writer`](plugins/tricity-writer).

## Local development

Prerequisites:

- Node.js 22.19 or later, and pnpm 12
- PostgreSQL and Redis, for example Homebrew services
- the databases `tricity_writer` and `tricity_writer_test`

```sh
cp .env.example .env         # fill in BETTER_AUTH_SECRET and ENCRYPTION_KEY: openssl rand -base64 32
pnpm install
pnpm db:migrate
pnpm wp:dev                  # WordPress Playground with the plugin: http://127.0.0.1:9400 (admin / password)
pnpm dev                     # dashboard :3000, API :4000, worker
```

Set `AI_FAKE=true` in `.env` to develop without AI keys. To check your work:

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @tricity/core e2e:connector [--seo=yoast|rankmath|aioseo] [--php=8.3]
scripts/smoke-prod.sh        # production build and startup, without Docker
```

### Repository layout

```
apps/web            Next.js dashboard
apps/api            Fastify: auth, REST API (/api/v1), MCP server (/mcp)
apps/worker         BullMQ jobs: generate, publish, auto-blog runs
packages/core       Domain logic shared by the API, MCP and worker
packages/db         Drizzle schema, migrations, tenant-scoped data access
packages/ai         Model registry, Anthropic and OpenAI providers, usage and cost
packages/jobs       Queues and per-site schedules
packages/shared     Shared contracts (connector API, jobs) and env loading
packages/wp-client  The only code that calls WordPress sites
plugins/tricity-writer  WordPress connector plugin (PHP)
deploy/             Docker Compose, Caddy, server bootstrap, deploy and backup scripts
docs/               User manual, deployment guide
```

`CLAUDE.md` holds the architecture notes, design decisions and conventions in more depth.

## Status and limitations

- **Tested:** release 1.0.0 is covered by 111 tests and a connector end-to-end suite (PHP 7.4 and 8.3, with Yoast, against WordPress 7.1). A browser pass ran on desktop and phone widths, using the built-in fake AI provider.
- **Not yet exercised:** live Anthropic and OpenAI calls, and the Docker images themselves. Tests pin the request formats and the production build is smoke-tested natively, so both first run for real on your server.
- **Not included yet:** billing (the monthly budget stands in for it), email providers other than Resend, rewriting existing posts, WooCommerce, and languages other than English.
