#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
umask 077
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
state="$base/state"
mkdir -p "$state"
chmod 700 "$state"
if [ -f "$state/vm.pid" ] && kill -0 "$(cat "$state/vm.pid")" 2>/dev/null; then
  if /usr/bin/python3 "$base/host/vm-runtime.py" --owns-process "$state" "$(cat "$state/vm.pid")"; then
    cat "$state/runtime.json"
    exit 0
  fi
  echo 'Existing VM PID cannot be verified; refusing to start another VM.' >&2
  exit 1
fi
if [ ! -f "$state/config.json" ]; then
  /usr/bin/python3 "$base/host/prepare.py"
fi
binary=$(/usr/bin/python3 "$base/host/vm-runtime.py" --executable "$state")
if [ "${1:-}" = '--foreground' ]; then
  echo "$$" > "$state/vm.pid"
  exec "$binary" "$state/config.json"
fi
nohup "$binary" "$state/config.json" > "$state/host.log" 2>&1 < /dev/null &
echo "$!" > "$state/vm.pid"
attempt=0
while [ "$attempt" -lt 90 ]; do
  if ! kill -0 "$(cat "$state/vm.pid")" 2>/dev/null; then
    cat "$state/host.log" >&2
    exit 1
  fi
  if "$base/host/vm-exec.sh" 'test -e /var/lib/cloud/instance/boot-finished && test -d /mnt/manta-transfer' >/dev/null 2>&1; then
    /usr/bin/python3 - "$state/runtime.json" <<'PY'
import json, sys, datetime
from pathlib import Path
path=Path(sys.argv[1]); data=json.loads(path.read_text())
data.update(guestReady=True,guestBootState='ready',guestUser='manta',guestArchitecture='aarch64',guestDistribution='Ubuntu 22.04',updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
path.write_text(json.dumps(data,indent=2)+'\n')
PY
    cat "$state/runtime.json"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done
echo 'VM started, but guest SSH/cloud-init readiness timed out. See state/console.log.' >&2
exit 1
