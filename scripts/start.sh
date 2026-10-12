#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../web"
if [ ! -f .env ]; then ../scripts/init-env.sh; fi
if [ ! -f .next/standalone/server.js ]; then echo 'Missing web build: run ./scripts/build.sh' >&2; exit 2; fi
set -a
. ./.env
set +a
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
exec node .next/standalone/server.js
