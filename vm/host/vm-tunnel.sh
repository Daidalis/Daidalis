#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state="$base/state"
port=${1:-8093}
case "$port" in ''|*[!0-9]*) echo 'Expected a loopback port number.' >&2; exit 1 ;; esac
if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then exit 1; fi
socket=$(/usr/bin/python3 "$base/host/vm-runtime.py" "$state")
exec /usr/bin/ssh -F /dev/null -T -N -i "$state/id_ed25519" \
  -o "ProxyCommand=/usr/bin/nc -U '$socket'" \
  -o "UserKnownHostsFile=$state/known_hosts" -o GlobalKnownHostsFile=/dev/null \
  -o HostKeyAlias=manta-nos3-local-vm -o StrictHostKeyChecking=accept-new \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:$port:127.0.0.1:8093" manta@localhost
