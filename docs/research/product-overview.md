# Product overview

## Positioning

- **Current pitch:** "run your WordPress site from Claude or ChatGPT". The product is now **MCP-first**, and the web dashboard is presented as the second way in. Earlier blog posts (Feb–Mar 2026) were dashboard-first, so the pivot happened during 2026. (home, launch blog)
- **Explicit philosophy:** "assistant, not autopilot". The AI proposes and the user picks:
  - topic ideas come as options
  - images come as several variations to browse
  - generated content opens in an editor for review before publishing
  - the user can generate tone variations and keep the best

  Automation came later and reuses the same pipeline. (blog: assistant-not-autopilot)
- **Templates as the core asset:** content and design templates hold the user's voice. Automation is "the same templates, with the scheduler pressing the button". (blog: automation)
- **Performance pitch:** output is plain HTML with no page-builder runtime, images are optimized server-side before upload, and no AI work runs on the WP host. (blog: pure HTML)
- **Language:** multi-language, including RTL (Hebrew, Arabic). The language is a per-site setting.
- **Related products:** the same company also runs **WP Agent** (getwpagent.com), WP Image Fixer, and TendMyStore. (egress-ips)

## Two ways to use it

1. **AI assistants (MCP):** a remote MCP server with 120+ tools that works in 10+ clients (Claude.ai, ChatGPT, Claude Code/Desktop, Cursor, VS Code, Windsurf, Codex/Gemini CLI, and others). See `mcp-server.md`.
2. **Dashboard:** a web UI with:
   - a 4-phase content wizard with preview
   - a template manager
   - auto-blogging setup
   - SEO tools and content health monitoring
   - a media library browser
   - Google Search Console integration (rankings, queries)
   - usage analytics

## Accounts

- Sign-up with email, Google, GitHub, or Facebook.
- Analytics and session replay run through PostHog.
- Emails cover onboarding tips (based on the site's recent posts), post-idea emails, failed-connection follow-ups, and per-post publish notifications from automation.

## Business model: BYOK

- Users add their **own** OpenAI, Anthropic, or Gemini keys under Settings → AI Models → Add New Model. Each model has a provider, display name, and key, and can be marked as a **global key** so it applies to all the user's sites.
- Keys are encrypted at rest and decrypted only when used.
- Content and image providers are configured separately. For example, Claude writes the text and Gemini makes the images.
- **Model auto-discovery:** they sync each provider's model list using the user's key, so new models show up without a release. They claim 50+ models.
- They charge for the platform, not tokens.
- **Exception, "AI Image Pack":** $24.99/mo for 100 images/month made on WPWriter's own key, so the user needs no provider account.

## Plans (as of 2026-10-26)

| | Starter | Blogger | Pro | Agency |
|---|---|---|---|---|
| Price/mo (annual) | Free | $19 ($15) | $49 ($39) | $99 ($79) |
| Sites | 1 (domain-locked, can't swap) | 2 (+$17/site) | 6 (+$13/site) | 10 (+$10/site) |
| Site swap cooldown | — | next billing period | 14 days | 7 days |
| AI post generations | 15 total, one-time | 60/mo (+20 per added site) | 150/mo (+25) | 300/mo (+30) |
| Max words per generation | 750 | 1,500 | 3,000 | 5,000 |
| AI images | 20 total | unlimited on own key | unlimited | unlimited |
| Images per post | 2 | 6 | 12 | unlimited |
| Auto-blogging | 1/day, publishes if quality check passes | 3/day, publishes if quality check passes | 8/day, full autopilot | 15/day, all modes |
| Support | community | 72h | 48h | 24h |

- Post generations are a **shared pool** across all of a user's sites.
- Paid plans can buy one-time **post boost packs** that never expire: 25/$5, 75/$12, 200/$25, 500/$50.
- Some features are listed by tier, but the per-tier differences weren't readable in text form: global content/design prompts, FTP auto-deploy, improve existing posts, and Search Console.
- MCP use draws on the same quotas as the dashboard, with no separate MCP pricing.
- Lemon Squeezy is the merchant of record and also handles affiliate tracking.

## Infrastructure (from the subprocessors page)

- **App servers and managed Postgres:** DigitalOcean, Frankfurt (EU).
- **Cloudflare:** DNS, CDN, TLS, WAF.
- **Mailgun:** outbound mail in the US region, inbound support mail in the EU region (moving to Cloudflare Email Routing).
- **Lemon Squeezy:** billing.
- **PostHog:** analytics and session replay, with typed input masked.
- **AI providers:** OpenAI, Anthropic, and Google are listed as subprocessors "only when you use WPWriter's AI generation features" (on WPWriter's own key). When a user brings their own key, that provider works under the user's agreement instead.
- **Frontend:** Angular SPA, client-rendered, with TinyMCE as the editor (from public page HTML).
- **Hosts:** separate API host `api.wpwriter.com` and MCP host `mcp.wpwriter.com`.
