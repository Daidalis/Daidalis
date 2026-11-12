#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state="$base/state"
/usr/bin/python3 "$base/host/name_compat.py" "$state" --save-profile
eval "$(/usr/bin/python3 "$base/host/name_compat.py" "$state" --shell)"
socket=$(/usr/bin/python3 "$base/host/vm-runtime.py" "$state")
if [ "$#" = 1 ]; then
  set -- "$(/usr/bin/python3 "$base/host/name_compat.py" "$state" --ssh-command "$1")"
elif [ "$#" -gt 1 ]; then
  set -- "$(/usr/bin/python3 "$base/host/name_compat.py" "$state" --ssh-argv "$@")"
fi
exec /usr/bin/ssh -F /dev/null -T -i "$state/id_ed25519" \
  -o "ProxyCommand=/usr/bin/nc -U '$socket'" \
  -o "UserKnownHostsFile=$state/known_hosts" -o GlobalKnownHostsFile=/dev/null \
  -o "HostKeyAlias=$DAIDALIS_VM_ALIAS" -o StrictHostKeyChecking=accept-new \
  -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  "$DAIDALIS_VM_USER@localhost" "$@"
