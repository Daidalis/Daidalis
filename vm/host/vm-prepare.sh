#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
umask 077
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$base/assets" "$base/state" "$base/host/module-cache" "$base/handoff"
chmod 700 "$base/state"
/usr/bin/python3 - "$base" <<'PY'
import platform, shutil, sys
from pathlib import Path
if platform.system()!='Darwin' or platform.machine()!='arm64': raise SystemExit('This local VM backend requires Apple Silicon macOS.')
base=Path(sys.argv[1]); prepared=all((base/name).is_file() for name in ['state/config.json','state/ubuntu.raw','host/manta-vm'])
required=5 if prepared else 8
if shutil.disk_usage(base).free < required*1024**3: raise SystemExit(f'At least {required} GiB host free space required; preserving the 5 GiB host reserve.')
PY
if [ -f "$base/state/config.json" ] && [ -f "$base/state/ubuntu.raw" ] && \
   [ -f "$base/state/image-manifest.json" ] && [ -f "$base/state/native-ready.json" ] && \
   [ -f "$base/assets/vmlinuz" ] && [ -f "$base/assets/initrd" ] && \
   [ -f "$base/state/seed.iso" ] && [ -x "$base/host/manta-vm" ]; then
  if [ "$base/host/main.swift" -nt "$base/host/manta-vm" ]; then
    /usr/bin/xcrun swiftc -module-cache-path "$base/host/module-cache" "$base/host/main.swift" -framework Virtualization -o "$base/host/manta-vm"
    /usr/bin/codesign --force --sign - --entitlements "$base/host/entitlements.plist" "$base/host/manta-vm"
  fi
  exec /usr/bin/python3 "$base/host/prepare.py"
fi
download() {
  if [ ! -s "$2" ]; then
    /usr/bin/curl -fLsS --retry 2 --connect-timeout 20 "$1" -o "$2.download"
    mv "$2.download" "$2"
  fi
}
release=https://cloud-images.ubuntu.com/jammy/20261020
download "$release/jammy-server-cloudimg-arm64.tar.gz" "$base/assets/jammy-server-cloudimg-arm64.tar.gz.part"
download "$release/SHA256SUMS" "$base/assets/jammy-SHA256SUMS"
download "$release/unpacked/SHA256SUMS" "$base/assets/jammy-unpacked-SHA256SUMS"
download "$release/unpacked/jammy-server-cloudimg-arm64-vmlinuz-generic" "$base/assets/jammy-vmlinuz.part"
download "$release/unpacked/jammy-server-cloudimg-arm64-initrd-generic" "$base/assets/jammy-initrd.part"
if [ ! -x "$base/host/manta-vm" ] || [ "$base/host/main.swift" -nt "$base/host/manta-vm" ]; then
  /usr/bin/xcrun swiftc -module-cache-path "$base/host/module-cache" "$base/host/main.swift" -framework Virtualization -o "$base/host/manta-vm"
  /usr/bin/codesign --force --sign - --entitlements "$base/host/entitlements.plist" "$base/host/manta-vm"
fi
exec /usr/bin/python3 "$base/host/prepare.py"
