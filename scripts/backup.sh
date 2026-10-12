#!/usr/bin/env bash
# Consistent backup only while the single writable Next.js service is stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${DRM_SERVICE_STOPPED:-}" != YES ]; then
  echo 'Stop the service, then set DRM_SERVICE_STOPPED=YES before backup.' >&2; exit 2
fi
if [ "$#" -ne 1 ]; then echo 'Usage: DRM_SERVICE_STOPPED=YES scripts/backup.sh /secure/path/backup.tar.gz' >&2; exit 2; fi
for f in web/.env web/data/drm.json web/data/graph.json; do
  if [ ! -f "$f" ] || [ -L "$f" ]; then echo "Missing or unsafe backup input: $f" >&2; exit 2; fi
done
# v0.6.x deployment convention. Custom data paths require an operator-specific backup procedure.
if ! grep -Eq '^DRM_DATA_FILE=\./data/drm.json$' web/.env || ! grep -Eq '^DRM_GRAPH_FILE=\./data/graph.json$' web/.env; then
  echo 'Backup only supports default web/data paths; write a procedure for your custom paths.' >&2; exit 2
fi
umask 077
output="$1"
if [ -e "$output" ] || [ -e "$output.sha256" ]; then echo 'Refusing to overwrite existing backup or checksum.' >&2; exit 2; fi
mkdir -p "$(dirname "$output")"
working="${output}.$$.tmp"
trap 'rm -f "$working"' EXIT
tar -C web -czf "$working" .env data/drm.json data/graph.json
mv -- "$working" "$output"
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")
chmod 600 "$output" "$output.sha256"
echo "Backup complete: $output (CONTAINS SECRETS; encrypt before off-host storage)"
