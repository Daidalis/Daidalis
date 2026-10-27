#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
APP_DATA=${MBSE_DATA_DIR:-"$APP_ROOT/data"}
PID_FILE="$APP_DATA/server.pid"
if [ -f "$PID_FILE" ]; then
  APP_PID=$(cat "$PID_FILE")
  if ps -p "$APP_PID" -o args= 2>/dev/null | grep -F "$APP_ROOT/server/index.mjs" >/dev/null 2>&1; then kill "$APP_PID"; fi
  rm -f "$PID_FILE"
fi
