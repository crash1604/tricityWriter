#!/usr/bin/env bash
# Ships the current checkout to the server and (re)starts the stack. Run from your computer:
#   deploy/deploy.sh root@SERVER_IP                 # first deploy on the server's IP
#   deploy/deploy.sh root@SERVER_IP app.example.com # first deploy on a domain (HTTPS)
# Later runs update the code and restart; deploy/.env on the server is never overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?usage: deploy/deploy.sh user@host [domain]}"
domain="${2:-}"
remote_dir=/opt/tricity

echo "==> Uploading code to $target:$remote_dir"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '.next' --exclude dist --exclude .turbo \
  --exclude .env --exclude deploy/.env --exclude 'plugins/*/vendor' --exclude '*.tsbuildinfo' \
  ./ "$target:$remote_dir/"

echo "==> Building and starting on the server (the first build takes several minutes)"
ssh "$target" "cd $remote_dir && \
  deploy/init-env.sh $domain && \
  docker compose -f deploy/docker-compose.yml up -d --build --remove-orphans && \
  docker image prune -f >/dev/null && \
  docker compose -f deploy/docker-compose.yml ps"

origin=$(ssh "$target" "grep '^WEB_ORIGIN=' $remote_dir/deploy/.env | cut -d= -f2-")
echo
echo "TriCity Writer is starting at $origin"
echo "Logs: ssh $target 'cd $remote_dir && docker compose -f deploy/docker-compose.yml logs -f api worker'"
