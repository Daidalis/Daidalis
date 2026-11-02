#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
if [ ! -f deploy/local/install.env ]; then echo 'Run install.sh first.' >&2; exit 1; fi
exec docker compose --env-file deploy/local/install.env "$@"
