#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
APP_BINARY="$APP_ROOT/build/Manta"
if [ "$(uname -s)" != "Darwin" ]; then echo "Desktop window currently supports macOS; use scripts/start.sh on this platform." >&2; exit 1; fi
APP_NODE=
if [ -n "${MBSE_NODE:-}" ]; then
  APP_NODE=$(command -v "$MBSE_NODE" 2>/dev/null || true)
elif command -v node >/dev/null 2>&1; then
  APP_NODE=$(command -v node)
else
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
mkdir -p "$APP_ROOT/build"
if [ ! -x "$APP_BINARY" ] || [ "$APP_ROOT/desktop/MBSEStudio.m" -nt "$APP_BINARY" ] || [ "$APP_ROOT/desktop/Info.plist" -nt "$APP_BINARY" ]; then
  /usr/bin/xcrun clang -fobjc-arc -O2 -mmacosx-version-min=12.0 -Wno-incompatible-pointer-types -framework Cocoa -framework WebKit -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$APP_ROOT/desktop/Info.plist" "$APP_ROOT/desktop/MBSEStudio.m" -o "$APP_BINARY"
fi
exec /usr/bin/python3 "$APP_ROOT/desktop/local-executable.py" "$APP_BINARY" "$APP_ROOT" "--source-root=$APP_ROOT" "--data-root=$APP_DATA" "--port=$APP_PORT" "$@"
