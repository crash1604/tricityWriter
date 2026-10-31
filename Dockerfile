# syntax=docker/dockerfile:1.7
# Two runtime images from one build:
#   target "server" — apps/api and apps/worker (same image, different command) plus migrations
#   target "web"    — the Next.js dashboard (standalone output)
# Used by deploy/docker-compose.yml.

FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@12.15.0 && apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
# Baked into the dashboard's rewrites; Caddy normally routes these paths to the API directly.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN ./scripts/build-plugin-zip.sh
RUN pnpm --filter @tricity/web build && pnpm --filter @tricity/api build && pnpm --filter @tricity/worker build
# Production dependencies only, hoisted, so the bundled apps resolve every external package from
# /repo/node_modules (workspace packages are already bundled into dist/).
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && pnpm install --prod --frozen-lockfile --config.node-linker=hoisted

FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production MIGRATIONS_DIR=/repo/packages/db/drizzle API_HOST=0.0.0.0
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/packages/db/drizzle ./packages/db/drizzle
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
