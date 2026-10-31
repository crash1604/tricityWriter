#!/usr/bin/env bash
# Packages the WordPress connector plugin as an installable zip:
#   dist/tricity-writer.zip and apps/web/public/downloads/tricity-writer.zip (served by the dashboard).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(sed -n 's/^ \* Version: *//p' plugins/tricity-writer/tricity-writer.php | head -1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/tricity-writer"
# Runtime files only; dev tooling (composer, phpcs, vendor) stays out of the package.
cp -R plugins/tricity-writer/src plugins/tricity-writer/tricity-writer.php plugins/tricity-writer/uninstall.php \
  plugins/tricity-writer/readme.txt "$work/tricity-writer/"

mkdir -p dist apps/web/public/downloads
rm -f dist/tricity-writer.zip
(cd "$work" && zip -qr -X "$OLDPWD/dist/tricity-writer.zip" tricity-writer)
cp dist/tricity-writer.zip apps/web/public/downloads/tricity-writer.zip
echo "Built dist/tricity-writer.zip (version ${version:-unknown})"
