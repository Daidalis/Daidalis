#!/bin/bash

# Paths and account are fixed by the host for existing VM disks.
export DAIDALIS_VM_ROOT=${DAIDALIS_VM_ROOT:-/srv/daidalis}
export DAIDALIS_VM_TRANSFER=${DAIDALIS_VM_TRANSFER:-/mnt/daidalis-transfer}
export DAIDALIS_VM_HOME=${DAIDALIS_VM_HOME:-/home/daidalis}
export DAIDALIS_VM_USER=${DAIDALIS_VM_USER:-daidalis}
set -euo pipefail
work_root=${1:-${DAIDALIS_VM_ROOT}/nos3}
jobs=${DAIDALIS_BUILD_JOBS:-4}
cd "$work_root"
export CFS_APP_PATH=../components
export MISSION_DEFS=../cfg/build/
export MISSIONCONFIG=../cfg/build/nos3
mkdir -p fsw/build sims/build ${DAIDALIS_VM_ROOT}/receipts
cmake -S fsw/cfe -B fsw/build -DCMAKE_INSTALL_PREFIX="$work_root/fsw/build/exe" -DCMAKE_BUILD_TYPE=Debug
cmake --build fsw/build --target mission-install --parallel "$jobs"
cmake -S sims -B sims/build -DCMAKE_INSTALL_PREFIX="$work_root/sims/build"
cmake --build sims/build --target install --parallel "$jobs"
# The pinned 42 archive already includes generated AutoCode C files. No headers
# are changed; consume those exact checked-in files without installing Julia.
make -C "$work_root/../42" -j"$jobs" GUIFLAG= SHADERFLAG= \
  -o MetaCode/Ac.json -o MetaCode/42.json
echo '42 uses the pinned checked-in generated C; no type headers changed.' > ${DAIDALIS_VM_ROOT}/receipts/fortytwo-codegen.txt
file "$work_root/fsw/build/exe/cpu1/core-cpu1" "$work_root/sims/build/bin/nos3-single-simulator" \
  "$work_root/../42/42" > ${DAIDALIS_VM_ROOT}/receipts/elf-architecture.txt
sha256sum "$work_root/fsw/build/exe/cpu1/core-cpu1" "$work_root/../42/42" \
  "$work_root/sims/build/bin/nos3-single-simulator" > ${DAIDALIS_VM_ROOT}/receipts/binaries.sha256
