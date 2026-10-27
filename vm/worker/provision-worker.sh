#!/bin/bash
set -euo pipefail
# This file executes only in the dedicated Linux guest. No host installation.
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then exit 2; fi
sudo mkdir -p /srv/manta/worker
sudo chown manta:manta /srv/manta/worker
exec python3 /mnt/manta-transfer/worker/provision-worker.py
