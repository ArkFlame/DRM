#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
exec "$SCRIPT_DIR/scripts/start.sh" "$@"
