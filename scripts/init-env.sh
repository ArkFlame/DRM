#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e web/.env ]; then echo 'web/.env already exists; preserved'; exit 0; fi
python3 - <<'PY'
from pathlib import Path
import secrets
file = Path('web/.env')
with file.open('x') as out:
    out.write('# Generated once. Keep private, back up securely. Never commit.\n')
    for key in ('DRM_WEB_PASSWORD','DRM_WEB_SESSION_SECRET','DRM_HASH_KEY'):
        out.write(key + '=' + secrets.token_urlsafe(48) + '\n')
    out.write('DRM_DATA_FILE=./data/drm.json\nDRM_GRAPH_FILE=./data/graph.json\n')
    out.write('DRM_PUBLIC_ORIGIN=https://drm.arkflame.com\nDRM_TRUST_PROXY=true\n')
    out.write('DRM_RETENTION_DAYS=180\nDRM_MAX_INSTALLATIONS=10000\n')
    out.write('BBB_EMBED_TOKEN=\nPORT=3000\nHOSTNAME=127.0.0.1\n')
file.chmod(0o600)
print('Generated unique web/.env credentials. Recover password from DRM_WEB_PASSWORD in web/.env.')
PY
