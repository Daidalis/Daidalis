#!/bin/bash
set -euo pipefail
work_root=${1:-/srv/manta/nos3}
jobs=${MANTA_BUILD_JOBS:-4}
cd "$work_root"
export CFS_APP_PATH=../components
export MISSION_DEFS=../cfg/build/
export MISSIONCONFIG=../cfg/build/nos3
mkdir -p fsw/build sims/build /srv/manta/receipts
cmake -S fsw/cfe -B fsw/build -DCMAKE_INSTALL_PREFIX="$work_root/fsw/build/exe" -DCMAKE_BUILD_TYPE=Debug
cmake --build fsw/build --target mission-install --parallel "$jobs"
cmake -S sims -B sims/build -DCMAKE_INSTALL_PREFIX="$work_root/sims/build"
cmake --build sims/build --target install --parallel "$jobs"
# The pinned 42 archive already includes generated AutoCode C files. No headers
# are changed; consume those exact checked-in files without installing Julia.
make -C "$work_root/../42" -j"$jobs" GUIFLAG= SHADERFLAG= \
  -o MetaCode/Ac.json -o MetaCode/42.json
echo '42 uses the pinned checked-in generated C; no type headers changed.' > /srv/manta/receipts/fortytwo-codegen.txt
file "$work_root/fsw/build/exe/cpu1/core-cpu1" "$work_root/sims/build/bin/nos3-single-simulator" \
  "$work_root/../42/42" > /srv/manta/receipts/elf-architecture.txt
sha256sum "$work_root/fsw/build/exe/cpu1/core-cpu1" "$work_root/../42/42" \
  "$work_root/sims/build/bin/nos3-single-simulator" > /srv/manta/receipts/binaries.sha256
