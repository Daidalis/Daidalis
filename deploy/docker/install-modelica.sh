#!/bin/sh
set -eu
if [ "${WITH_MODELICA:-0}" = 0 ]; then exit 0; fi
if [ "${WITH_MODELICA:-0}" != 1 ]; then echo 'WITH_MODELICA must be 0 or 1' >&2; exit 2; fi
apt-get update
rm -f /etc/apt/apt.conf.d/docker-clean
printf 'APT::Keep-Downloaded-Packages "true";\nBinary::apt::APT::Keep-Downloaded-Packages "true";\n' > /etc/apt/apt.conf.d/keep-cache
apt-get install -y --no-install-recommends gnupg aria2
python3 - <<'PY'
import urllib.request
with urllib.request.urlopen('https://build.openmodelica.org/apt/openmodelica.asc',timeout=60) as r:
    data=r.read(65537)
if len(data)>65536:raise RuntimeError('Unexpected OpenModelica signing key size')
open('/tmp/openmodelica.asc','wb').write(data)
PY
gpg --batch --dearmor --output /usr/share/keyrings/openmodelica.gpg /tmp/openmodelica.asc
printf 'deb [arch=%s signed-by=/usr/share/keyrings/openmodelica.gpg] https://build.openmodelica.org/omc/builds/linux/releases/1.27.1/ bookworm release\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/openmodelica.list
apt-get -o Acquire::https::Timeout=30 -o Acquire::Retries=2 update
# Install the native editor alongside the compiler when a desktop was selected.
export MODELICA_GUI=0
case ",${TOOLCHAINS:-}," in *,desktop,*) MODELICA_GUI=1 ;; esac
MODELICA_VERSION="$MODELICA_VERSION" python3 /opt/fetch-modelica.py
set -- "omc=${MODELICA_VERSION}" omlibrary
if [ "$MODELICA_GUI" = 1 ]; then set -- "$@" "omedit=${MODELICA_VERSION}"; fi
timeout -k 30 3600 apt-get -o Acquire::https::Timeout=30 -o Acquire::Retries=2 install -y --no-install-recommends "$@"
omc --version
# Materialize the bundled standard library once, rather than unpacking it and
# refreshing the online package index for every task's temporary HOME.
mkdir -p /tmp/manta-modelica-preload
printf 'loadModel(Modelica,{"4.0.0"});\ngetErrorString();\n' > /tmp/manta-preload.mos
HOME=/tmp/manta-modelica-preload omc /tmp/manta-preload.mos > /tmp/manta-preload.log
test -f '/tmp/manta-modelica-preload/.openmodelica/libraries/Modelica 4.0.0+maint.om/package.mo'
cp -a /tmp/manta-modelica-preload/.openmodelica/libraries /opt/modelica-libraries
chmod -R a+rX /opt/modelica-libraries
rm -rf /tmp/manta-modelica-preload /tmp/manta-preload.mos /tmp/manta-preload.log
rm -rf /var/lib/apt/lists/* /tmp/openmodelica.asc
