#!/usr/bin/env bash
# Dumps the database to /var/backups/tricity and keeps the last 14 days. Scheduled nightly by
# bootstrap-vps.sh. Restore: gunzip -c FILE | docker compose -f deploy/docker-compose.yml exec -T postgres psql -U tricity tricity
set -euo pipefail
cd "$(dirname "$0")"

dir=/var/backups/tricity
mkdir -p "$dir"
file="$dir/tricity-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose -f docker-compose.yml exec -T postgres pg_dump -U tricity --clean --if-exists tricity | gzip > "$file"
chmod 600 "$file"
find "$dir" -name 'tricity-*.sql.gz' -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup written: $file ($(du -h "$file" | cut -f1))"
