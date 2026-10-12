#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${DRM_SERVICE_STOPPED:-}" != YES ] || [ "${DRM_CONFIRM_RESTORE:-}" != YES ]; then
  echo 'Stop the service. Set DRM_SERVICE_STOPPED=YES and DRM_CONFIRM_RESTORE=YES before restore.' >&2; exit 2
fi
if [ "$#" -ne 1 ]; then echo 'Usage: scripts/restore.sh /secure/path/backup.tar.gz' >&2; exit 2; fi
archive="$(realpath -- "$1")"
if [ ! -f "$archive" ] || [ ! -f "$archive.sha256" ]; then echo 'Backup and SHA-256 sidecar are required' >&2; exit 2; fi
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
umask 077
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
python3 scripts/verify-backup.py "$archive" "$stage"
# Validate the actual schema before touching the existing deployment.
node --input-type=module - "$stage" <<'JS'
import { Store } from './web/src/server/installations.mjs';
import { NetworkGraph } from './web/src/server/network.mjs';
import { join } from 'node:path';
const base = process.argv[2];
await new Store(join(base, 'data/drm.json')).load();
await new NetworkGraph(join(base, 'data/graph.json')).load();
console.log('BACKUP_SCHEMA_PASS');
JS
# An operator-managed rescue copy is mandatory when replacing an existing dataset.
if [ -e web/.env ] || [ -e web/data/drm.json ] || [ -e web/data/graph.json ]; then
  echo 'Existing data present. Save a verified offline rescue copy before restoring. Refusing overwrite.' >&2
  echo 'Move existing web/.env and web/data/*.json to a separate protected rescue directory while service is stopped, then rerun.' >&2
  exit 2
fi
mkdir -p web/data
install -m 600 "$stage/.env" web/.env
install -m 600 "$stage/data/drm.json" web/data/drm.json
install -m 600 "$stage/data/graph.json" web/data/graph.json
echo 'RESTORE_PASS: start the service and run smoke tests before reopening ingress.'
