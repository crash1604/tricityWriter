#!/usr/bin/env bash
# Production smoke test without Docker. Reproduces the Dockerfile's build in a scratch copy of the repo
# (full install → plugin zip → builds → hoisted production-only reinstall), then starts what the
# containers run (migrate, api, worker, the standalone dashboard) with NODE_ENV=production and checks
# the paths a real deployment uses.
#
#   scripts/smoke-prod.sh [workdir]
#
# Uses TEST_DATABASE_URL (from .env) and Redis database 15, so dev data and dev queues are untouched.
# Ports: API 4100, dashboard 3100.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)

work="${1:-${TMPDIR:-/tmp}/tricity-smoke}"
api_port=4100
web_port=3100
origin="http://localhost:$web_port"
redis_url="redis://127.0.0.1:6379/15"

# shellcheck disable=SC1091
set -a; [[ -f .env ]] && . ./.env; set +a
database_url="${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set (see .env.example)}"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  redis-cli -n 15 --scan --pattern 'bull:*' | xargs -r redis-cli -n 15 del >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "  ✗ $*" >&2; exit 1; }
ok() { echo "  ✓ $*"; }
# Every check either passes or stops the run; a silently skipped check is how stale servers hide.
check() {
  local label=$1
  shift
  if "$@"; then ok "$label"; else fail "$label"; fi
}

for port in $api_port $web_port; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $port is already in use (a previous run still going?): lsof -nP -iTCP:$port -sTCP:LISTEN"
  fi
done

echo "==> Copying the repo to $work"
mkdir -p "$work"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude dist --exclude .turbo \
  --exclude .env --exclude 'deploy/.env' --exclude '*.tsbuildinfo' --exclude 'apps/web/public/downloads' \
  ./ "$work/repo/"
cd "$work/repo"

echo "==> Build stage (as in the Dockerfile)"
pnpm install --frozen-lockfile --silent
./scripts/build-plugin-zip.sh
API_INTERNAL_URL="http://127.0.0.1:$api_port" NEXT_TELEMETRY_DISABLED=1 pnpm --filter @tricity/web build >"$work/web-build.log" 2>&1 ||
  { tail -40 "$work/web-build.log"; fail "dashboard build"; }
pnpm --filter @tricity/api build >"$work/api-build.log" 2>&1 || { tail -40 "$work/api-build.log"; fail "api build"; }
pnpm --filter @tricity/worker build >"$work/worker-build.log" 2>&1 || { tail -40 "$work/worker-build.log"; fail "worker build"; }
ok "builds"

echo "==> Production dependencies only, hoisted"
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install --prod --frozen-lockfile --config.node-linker=hoisted --silent
ok "hoisted production install"

echo "==> Dashboard image layout (as in the Dockerfile's web stage)"
rm -rf "$work/web"
mkdir -p "$work/web"
cp -R apps/web/.next/standalone/. "$work/web/"
mkdir -p "$work/web/apps/web/.next"
cp -R apps/web/.next/static "$work/web/apps/web/.next/static"
cp -R apps/web/public "$work/web/apps/web/public"
ok "standalone server with static files and public/"

# The test database's OAuth signing keys are encrypted with the secret every test suite uses
# ('x' × 40, see CLAUDE.md), so the smoke run must use it too.
export NODE_ENV=production DATABASE_URL="$database_url" REDIS_URL="$redis_url" WEB_ORIGIN="$origin" \
  BETTER_AUTH_SECRET="$(printf 'x%.0s' $(seq 1 40))" \
  ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}" \
  MIGRATIONS_DIR="$work/repo/packages/db/drizzle" AI_FAKE=true EMAIL_PROVIDER=none SIGNUP_MODE=open \
  PLATFORM_MONTHLY_BUDGET_USD=5 ALLOW_PRIVATE_SITE_URLS=false

echo "==> Containers"
node apps/api/dist/migrate.js >"$work/migrate.log" 2>&1 || { cat "$work/migrate.log"; fail "migrate"; }
ok "migrate"

API_PORT=$api_port API_HOST=127.0.0.1 node apps/api/dist/index.js >"$work/api.log" 2>&1 &
pids+=($!)
node apps/worker/dist/index.js >"$work/worker.log" 2>&1 &
pids+=($!)
# exec, so the recorded PID is the server itself and cleanup really stops it.
(cd "$work/web" && PORT=$web_port HOSTNAME=127.0.0.1 exec node apps/web/server.js >"$work/web.log" 2>&1) &
pids+=($!)

wait_for() {
  local url=$1 what=$2
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1
  done
  echo "--- api.log"; tail -20 "$work/api.log"; echo "--- web.log"; tail -20 "$work/web.log"
  fail "$what did not start"
}
wait_for "http://127.0.0.1:$api_port/health" "the API"
wait_for "http://127.0.0.1:$web_port/sign-in" "the dashboard"

echo "==> Checks"
api="http://127.0.0.1:$api_port"
web="http://127.0.0.1:$web_port"
check "API health (database reachable)" sh -c "curl -fsS '$api/health' | grep -q '\"ok\":true'"
check "worker consumes the generation queue" grep -q 'listening on "generation"' "$work/worker.log"
check "landing page renders" sh -c "curl -fsS '$web/' | grep -q 'TriCity Writer'"
check "dashboard proxies /api to the API" sh -c "curl -fsS '$web/api/public/config' | grep -q '\"signupMode\":\"open\"'"
check "plugin update manifest is served" sh -c "curl -fsS '$web/downloads/tricity-writer.json' | grep -q '\"version\"'"
check "plugin zip downloads" curl -fsS -o /dev/null "$web/downloads/tricity-writer.zip"

email="smoke-$(date +%s)-$RANDOM@example.com"
jar="$work/cookies.txt"
rm -f "$jar"
code=$(curl -sS -o "$work/signup.json" -w '%{http_code}' -c "$jar" -H "origin: $origin" -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"correct horse battery\",\"name\":\"Smoke\"}" \
  "http://127.0.0.1:$web_port/api/auth/sign-up/email")
[[ $code == 200 ]] || { cat "$work/signup.json"; fail "sign-up returned $code"; }
ok "sign-up through the dashboard origin"
check "session cookie works for /api/v1" sh -c "curl -fsS -b '$jar' -H 'origin: $origin' '$web/api/v1/me' | grep -q '$email'"
check "usage reports the platform budget" sh -c "curl -fsS -b '$jar' -H 'origin: $origin' '$web/api/v1/usage' | grep -q '\"budgetUsd\":5'"
code=$(curl -sS -o /dev/null -w '%{http_code}' -b "$jar" -H "origin: $origin" -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:9400","code":"ABCD-EFGH-JKLM"}' "http://127.0.0.1:$web_port/api/v1/sites/pair")
[[ $code == 400 ]] && ok "pairing refuses private addresses in production" || fail "private pairing returned $code"
mcp=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' \
  "http://127.0.0.1:$web_port/mcp")
[[ $mcp == 401 ]] && ok "MCP requires authentication" || fail "MCP returned $mcp"

if grep -q 'could not determine a client IP' "$work/api.log"; then
  fail "Better Auth can't see client IPs, so every visitor shares one rate-limit bucket"
fi
ok "rate limiting sees each client's IP"

echo "All production smoke checks passed. Logs: $work"
