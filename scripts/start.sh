#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
APP_NODE=
if [ -n "${MBSE_NODE:-}" ]; then
  APP_NODE=$(command -v "$MBSE_NODE" 2>/dev/null || true)
elif command -v node >/dev/null 2>&1; then
  APP_NODE=$(command -v node)
elif [ "$(uname -s)" = "Darwin" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then APP_NODE=$candidate; break; fi
  done
fi
if [ -z "$APP_NODE" ] || [ ! -x "$APP_NODE" ]; then
  echo "Manta requires Node.js 22.13 or newer on PATH, or a valid MBSE_NODE executable." >&2
  exit 1
fi
"$APP_NODE" -e 'if((v=>v[0]<22||(v[0]===22&&v[1]<13))(process.versions.node.split(".").map(Number))){console.error("Manta requires Node.js 22.13 or newer.");process.exit(1)}'
APP_NODE=$("$APP_NODE" -p 'process.execPath')
export MBSE_NODE="$APP_NODE"
APP_PORT=$("$APP_NODE" "$APP_ROOT/scripts/launch-config.mjs" port)
APP_DATA=$("$APP_NODE" "$APP_ROOT/scripts/launch-config.mjs" data)
mkdir -p "$APP_DATA"
APP_DATA=$(CDPATH= cd -- "$APP_DATA" && pwd -P)
export MBSE_DATA_DIR="$APP_DATA"
if curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null | grep -q '"app":"mbse-studio"'; then
  echo "Manta is already running at http://127.0.0.1:$APP_PORT"
else
  cd "$APP_ROOT"
  if [ "${MBSE_FOREGROUND:-0}" = "1" ]; then
    echo $$ >"$APP_DATA/server.pid"
    exec "$APP_NODE" "$APP_ROOT/server/index.mjs"
  fi
  nohup "$APP_NODE" "$APP_ROOT/server/index.mjs" >>"$APP_DATA/server.log" 2>&1 </dev/null &
  echo $! >"$APP_DATA/server.pid"
  APP_READY=0
  for APP_ATTEMPT in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 1 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null | grep -q '"app":"mbse-studio"'; then APP_READY=1; break; fi
    sleep 1
  done
  if [ "$APP_READY" -ne 1 ]; then echo "Startup failed. See $APP_DATA/server.log" >&2; exit 1; fi
fi
if [ "${MBSE_NO_OPEN:-0}" != "1" ]; then
  case "$(uname -s)" in
    Darwin) open "http://127.0.0.1:$APP_PORT" ;;
    Linux) if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1 || true; fi ;;
  esac
fi
echo "http://127.0.0.1:$APP_PORT"
