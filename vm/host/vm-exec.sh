#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state="$base/state"
socket=$(/usr/bin/python3 "$base/host/vm-runtime.py" "$state")
exec /usr/bin/ssh -F /dev/null -T -i "$state/id_ed25519" \
  -o "ProxyCommand=/usr/bin/nc -U '$socket'" \
  -o "UserKnownHostsFile=$state/known_hosts" -o GlobalKnownHostsFile=/dev/null \
  -o HostKeyAlias=manta-nos3-local-vm -o StrictHostKeyChecking=accept-new \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  manta@localhost "$@"
