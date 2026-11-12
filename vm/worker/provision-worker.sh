#!/bin/bash

# Paths and account are fixed by the host for existing VM disks.
export DAIDALIS_VM_ROOT=${DAIDALIS_VM_ROOT:-/srv/daidalis}
export DAIDALIS_VM_TRANSFER=${DAIDALIS_VM_TRANSFER:-/mnt/daidalis-transfer}
export DAIDALIS_VM_HOME=${DAIDALIS_VM_HOME:-/home/daidalis}
export DAIDALIS_VM_USER=${DAIDALIS_VM_USER:-daidalis}
set -euo pipefail
# This file executes only in the dedicated Linux guest. No host installation.
if [[ $(uname -s) != Linux || $(uname -m) != aarch64 ]]; then exit 2; fi
sudo mkdir -p ${DAIDALIS_VM_ROOT}/worker
sudo chown ${DAIDALIS_VM_USER}:${DAIDALIS_VM_USER} ${DAIDALIS_VM_ROOT}/worker
exec python3 ${DAIDALIS_VM_TRANSFER}/worker/provision-worker.py
