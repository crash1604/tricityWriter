#!/usr/bin/env bash
# Packages the WordPress connector plugin as an installable zip:
#   dist/tricity-writer.zip and apps/web/public/downloads/tricity-writer.zip (served by the dashboard),
# plus apps/web/public/downloads/tricity-writer.json, the version manifest connected sites read to offer
# plugin updates (plugins/tricity-writer/src/Updater.php).
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

# Requirements come from readme.txt; the changelog is the newest entry, as HTML for the "View details" dialog.
node - "$version" plugins/tricity-writer/readme.txt apps/web/public/downloads/tricity-writer.json <<'NODE'
const fs = require('node:fs');
const [version, readmePath, out] = process.argv.slice(2);
const readme = fs.readFileSync(readmePath, 'utf8');
const field = (name) => readme.match(new RegExp(`^${name}: *(.+)$`, 'm'))?.[1]?.trim() ?? '';
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const latest = (readme.split('== Changelog ==')[1] ?? '').split(/^= /m)[1] ?? '';
const items = latest.split('\n').filter((l) => l.startsWith('* ')).map((l) => `<li>${escape(l.slice(2))}</li>`);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Bad plugin version: ${version}`);
if (field('Stable tag') !== version) throw new Error(`readme.txt Stable tag ${field('Stable tag')} != plugin ${version}`);
const manifest = {
  version,
  requires: field('Requires at least'),
  requires_php: field('Requires PHP'),
  tested: field('Tested up to'),
  changelog: `<h4>${version}</h4><ul>${items.join('')}</ul>`,
};
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
echo "Built dist/tricity-writer.zip and its update manifest (version ${version:-unknown})"
