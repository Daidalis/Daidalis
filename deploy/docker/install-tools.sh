#!/bin/sh
set -eu
packages=""
oldIFS=$IFS
IFS=,
for group in $TOOLCHAINS; do
  case "$group" in
    '') ;;
    scipy) packages="$packages python3-numpy python3-scipy python3-matplotlib" ;;
    ngspice) packages="$packages ngspice" ;;
    openscad) packages="$packages openscad xvfb xauth" ;;
    browser) packages="$packages chromium fonts-noto-cjk" ;;
    desktop) packages="$packages xvfb xauth openbox xdotool imagemagick x11vnc novnc websockify xterm fonts-noto-cjk" ;;
    freecad) packages="$packages freecad" ;;
    scilab) packages="$packages scilab" ;;
    gis) packages="$packages gdal-bin python3-gdal proj-bin" ;;
    *) echo "Unsupported toolchain: $group" >&2; exit 2 ;;
  esac
done
IFS=$oldIFS
if [ -n "$packages" ]; then
  rm -f /etc/apt/apt.conf.d/docker-clean
  apt-get update
  # Deliberate word splitting: package names come only from the fixed allowlist above.
  python3 /opt/fetch-packages.py $packages
  apt-get install -y --no-install-recommends $packages
  rm -rf /var/lib/apt/lists/*
fi
printf '%s\n' "$TOOLCHAINS" > /opt/toolchains.txt
