#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../web"
command -v npm >/dev/null || { echo 'npm CLI missing' >&2; exit 2; }
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
echo 'Generated web/package-lock.json. Inspect the transitive dependency tree, audit licenses/vulnerabilities, then commit the lockfile before running ./scripts/build.sh.'
