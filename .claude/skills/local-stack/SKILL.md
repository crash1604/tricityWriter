---
name: local-stack
description: Start, drive and stop TriCity Writer locally (dashboard, API, worker, WordPress Playground with the connector) to see a change working in the real app. Use when asked to run, start, demo, screenshot or click through the app, to pair a local WordPress site, or to check a flow end to end in a browser.
---

# Run TriCity Writer locally

Local development runs without Docker: Homebrew Postgres 18 and Redis, `pnpm dev`, and WordPress Playground.

## Start

1. Services must be up: `brew services list | grep -E 'postgresql@18|redis'` shows both `started`. If not: `brew services start postgresql@18 redis`.
2. `.env` exists at the repo root (copy `.env.example`; fill `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` with `openssl rand -base64 32`). For local work it needs `AI_FAKE=true` (unless real keys are set) and `ALLOW_PRIVATE_SITE_URLS=true` (Playground listens on 127.0.0.1, which the production fetch refuses).
3. `pnpm db:migrate`
4. Start these as background tasks:
   - `pnpm dev`: dashboard on http://localhost:3000, API on :4000, worker
   - `pnpm wp:dev`: WordPress on http://127.0.0.1:9400 (admin / password) with the connector plugin mounted from `plugins/tricity-writer`
5. Ready when `curl -s localhost:4000/health` returns `{"ok":true,...}` and `curl -s -o /dev/null -w '%{http_code}' localhost:3000/sign-in` returns 200. The first Next request compiles the page and takes a few seconds.

Open the dashboard at **http://localhost:3000**, never 127.0.0.1:3000. Next's dev server only serves its scripts to localhost, and auth cookies follow `WEB_ORIGIN`.

## Drive it

- **Account:** sign up at `/sign-up`. Every account gets its own workspace.
- **Emails:** with `EMAIL_PROVIDER=none`, invitation, password-reset and verification emails are written to the API output (search the `pnpm dev` log for `Email not sent`). Invitations also show a copyable link in Settings.
- **Pair the local WordPress site:**
  1. Log in at http://127.0.0.1:9400/wp-admin (admin / password).
  2. Open **TriCity Writer** in the admin menu, name the connection and generate a pairing code.
  3. In the dashboard: Sites → Connect a site, address `http://127.0.0.1:9400`, then the code.
  `wp:dev` uses `--no-login` on purpose: auto-login redirects every cookieless request, including our API's.
- **Articles:** with `AI_FAKE=true` the wizard produces placeholder articles and SVG images at no cost, so the whole flow (write → review → publish to Playground) works offline.
- **Sign-up modes, budgets, verification:** these are API settings read at startup (`SIGNUP_MODE`, `PLATFORM_MONTHLY_BUDGET_USD`, `REQUIRE_EMAIL_VERIFICATION` + `EMAIL_PROVIDER`). Change `.env` and restart `pnpm dev`. `GET /api/public/config` shows what the auth pages see.
- **MCP:** create a key in Settings → MCP, then call `POST http://localhost:3000/mcp` with `Authorization: Bearer tcw_mcp_…`.

## Browser automation

Use Claude in Chrome (load the `claude-in-chrome` skill first). Work in a new tab, avoid buttons that open `window.confirm` (the app uses inline confirmations, so none should), and check `read_console_messages` for React errors after each page.

## Stop

Stop the background tasks (TaskStop). Playground keeps nothing between runs.

## Gotchas

- Port in use: `lsof -nP -iTCP:3000 -sTCP:LISTEN` (or 4000/9400) and stop the old process.
- After editing packages under `packages/*`, the API and worker restart themselves (tsx watch); the dashboard hot-reloads.
- Rank Math prints no head tags under Playground; that's Playground, not us.
