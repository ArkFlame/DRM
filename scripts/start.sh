#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The first launch can bootstrap an unbuilt checkout. Do not serve a partial
# build, or a standalone server left over from an older source release.
release_version="$(python3 -c "import json; print(json.load(open('web/package.json'))['version'])")"
ready() {
  [ -f web/.next/standalone/server.js ] &&
    [ -f web/.next/standalone/.build-complete ] &&
    grep -Fxq "version=$release_version" web/.next/standalone/.build-complete
}
if ! ready; then
  echo 'No completed web release found; building before startup.' >&2
  ./scripts/build.sh
fi
if ! ready; then
  echo 'Build did not produce a complete standalone web release; startup aborted.' >&2
  exit 2
fi
if [ ! -f web/.env ]; then ./scripts/init-env.sh; fi
cd web
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
exec node --env-file=.env .next/standalone/server.js
