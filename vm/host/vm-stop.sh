#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
state="$base/state"
if [ ! -f "$state/vm.pid" ]; then exit 0; fi
pid=$(cat "$state/vm.pid")
if ! kill -0 "$pid" 2>/dev/null; then exit 0; fi
if ! /usr/bin/python3 "$base/host/vm-runtime.py" --owns-process "$state" "$pid"; then
  echo 'PID no longer belongs to this Manta VM; refusing signal.' >&2
  exit 1
fi
kill -TERM "$pid"
attempt=0
while kill -0 "$pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
  sleep 1
  attempt=$((attempt + 1))
done
if kill -0 "$pid" 2>/dev/null; then echo 'VM has not stopped; inspect state/host.log.' >&2; exit 1; fi
cat "$state/runtime.json"
