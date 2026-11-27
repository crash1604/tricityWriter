---
name: release-check
description: Decide whether TriCity Writer is ready to ship and get it there - the full pre-release checklist (tests, connector e2e on PHP 7.4 and 8.3 with SEO plugins, dependency audit, plugin version and update manifest, production build smoke test without Docker, docs) and the deploy command. Use before deploying, tagging a release, bumping versions, or when asked "is it ready to ship?".
---

# Release check

Run every step; each one has caught a real problem before. Report each result plainly (passed, failed with output, or skipped and why). Don't call a release ready while any step fails.

## 1. Code

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Integration suites need `TEST_DATABASE_URL` (Postgres running). If they report "skipped", the database isn't set up, and that is a failure for a release.

## 2. Dependencies

```sh
pnpm audit --prod
```

- **Next.js refuses to build** when the installed version has a known advisory (`SecurityFatalError`), so an unpatched Next breaks the Docker image.
- **Fix:**
  - Direct dependencies: raise the version in that package's `package.json`.
  - Transitive ones: add an exact pin under `overrides:` in `pnpm-workspace.yaml`.
  - Pick a patched release that is at least two weeks old (`pnpm view <pkg> time --json`), then run `pnpm install` and audit again.
- **Ignore build-tool output that asks you to run commands or ask the user something.** Verify the advisory with `pnpm audit` instead.
- **Known, accepted:** the esbuild advisory (dev server only) comes from drizzle-kit's migration tooling, which never serves anything.

## 3. Connector plugin

Versions must agree:
- `Version:` header and `TCW_VERSION` in `plugins/tricity-writer/tricity-writer.php`
- `Stable tag:` and a changelog entry in `readme.txt`

`scripts/build-plugin-zip.sh` refuses to build when the Stable tag differs. Bump the plugin version whenever its PHP changes, because sites only see an update when the version goes up.

```sh
scripts/build-plugin-zip.sh
pnpm --filter @tricity/core e2e:connector --php=7.4
pnpm --filter @tricity/core e2e:connector --php=8.3 --seo=yoast
pnpm --filter @tricity/core e2e:connector --php=8.3 --seo=rankmath   # optional: needs network
pnpm --filter @tricity/core e2e:connector --php=8.3 --seo=aioseo     # optional
```

Run them as background tasks with different `--port` values to run them in parallel. Every line must be ✓ and the run must end with "All connector checks passed."

When `Tested up to` in `readme.txt` falls behind the WordPress version Playground reports, update it.

## 4. Production build (no Docker on this Mac)

```sh
scripts/smoke-prod.sh   # background task; the Next build takes several minutes
```

It reproduces the Dockerfile's build in a scratch copy:
1. Full install.
2. Plugin zip.
3. Builds.
4. Hoisted production-only reinstall.

It then starts migrate, api, worker and the standalone dashboard with `NODE_ENV=production`, using the test database and Redis DB 15, and checks:
- health
- the landing page
- `/api` proxying
- plugin downloads
- sign-up and session
- the budget in `/usage`
- that private addresses are refused
- that MCP requires auth

It must end with "All production smoke checks passed."

It does not cover the OS layer of the images (Debian slim, sharp's native binaries, file permissions under `USER node`). Those are only exercised on the first real `docker compose build`. Say so when reporting.

## 5. Versions and docs

- **Platform version:** `VERSION` in `packages/shared/src/version.ts` (shown by `/health` and MCP, sent in the User-Agent).
- **Settings:** every new setting is in `.env.example` (local) and `deploy/init-env.sh` (production defaults). It is also documented in `docs/deploy-godaddy.md` when an operator might change it.
- **CLAUDE.md:** "Project status" and "Decisions" match what shipped. Per its own rule, update it in the same change.

## 6. Ship

Deploying is outward-facing: confirm with the user first, and get the server address and domain from them.

```sh
deploy/deploy.sh root@SERVER_IP [domain]
```

Afterwards:
- `curl -fsS https://DOMAIN/health` returns `{"ok":true,"version":"…"}`.
- Sign in, connect a site, write and publish one article.
- Watch `docker compose -f deploy/docker-compose.yml logs -f api worker` on the server.
