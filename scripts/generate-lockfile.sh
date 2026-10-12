#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../web"
command -v npm >/dev/null || { echo 'npm CLI missing' >&2; exit 2; }
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
test -s package-lock.json || { echo 'npm reported success but web/package-lock.json is missing or empty' >&2; exit 2; }
echo 'web/package-lock.json generated. Review and commit this lockfile for repeatable builds; future builds use npm ci.'
