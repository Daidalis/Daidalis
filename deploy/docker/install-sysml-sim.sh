#!/bin/sh
# Provision OpenSysML + FMPy for the SysML FMI backend inside the image.
# Pinned release and checksum; no host install and no runtime download.
set -eu
if [ "${WITH_SYML_SIM:-0}" = 0 ]; then exit 0; fi
if [ "${WITH_SYML_SIM:-0}" != 1 ]; then echo 'WITH_SYML_SIM must be 0 or 1' >&2; exit 2; fi

OPENSYSML_VERSION=v0.12.1
OPENSYSML_HOME=/opt/opensysml
PYTHON_PACKAGE_VERSION=0.12.1

case "$(dpkg --print-architecture)" in
  amd64) asset=sysml-grpc-linux-amd64
         digest=f6529a689c71e9d451865d79ece59b0fe8b92d5f4dcf3af90ce167adaeb9e465 ;;
  arm64) asset=sysml-grpc-linux-arm64
         digest=2afbbf189334917c9988a0c3e0bf7429fc5b56a3aae41a2962f887c72bd9c6e9 ;;
  *) echo "Unsupported architecture for sysml-grpc: $(dpkg --print-architecture)" >&2; exit 2 ;;
esac

# Keep this native FMI stack out of the application's system Python: the task
# image also contains SciPy/OpenModelica dependencies with their own constraints.
# Use TLS for Debian indexes and package downloads, including restricted networks.
python3 - <<'PY'
from pathlib import Path
for source in Path('/etc/apt/sources.list.d').glob('debian.sources'):
    source.write_text(source.read_text().replace('https://deb.debian.org/', 'http://mirrors.aliyun.com/').replace('http://deb.debian.org/', 'http://mirrors.aliyun.com/').replace('https://mirrors.aliyun.com/', 'http://mirrors.aliyun.com/'))
PY
apt-get -o Dir::Etc::sourcelist=sources.list.d/debian.sources -o Dir::Etc::sourceparts=- -o Acquire::Retries=3 -o APT::Update::Error-Mode=any update
python3 /opt/fetch-packages.py python3-venv
apt-get install -y --no-install-recommends python3-venv
rm -rf /var/lib/apt/lists/*

python3 -m venv "$OPENSYSML_HOME/venv"
"$OPENSYSML_HOME/venv/bin/python" -m pip install --no-cache-dir --disable-pip-version-check --timeout=120 --retries=5 \
  "opensysml[fmi]==${PYTHON_PACKAGE_VERSION}" 'fmpy==0.3.32'

mkdir -p "$OPENSYSML_HOME/bin"
python3 - "$asset" "$digest" "$OPENSYSML_VERSION" "$OPENSYSML_HOME/bin/sysml-grpc" <<'PY'
import hashlib, sys, urllib.request

asset, digest, version, target = sys.argv[1:]
url = 'https://github.com/Open-MBEE/OpenSysML/releases/download/%s/%s' % (version, asset)
request = urllib.request.Request(url, headers={'User-Agent': 'daidalis-sysml-sim-installer'})
with urllib.request.urlopen(request, timeout=120) as response:
    body = response.read(512 * 1024 * 1024 + 1)
if len(body) > 512 * 1024 * 1024:
    raise SystemExit('%s is larger than any release binary' % asset)
if hashlib.sha256(body).hexdigest() != digest:
    raise SystemExit('sysml-grpc checksum mismatch for %s' % asset)
with open(target, 'wb') as handle:
    handle.write(body)
PY
chmod 0755 "$OPENSYSML_HOME/bin/sysml-grpc"

# FMPy prints a logger-proxy warning on import when its bundled logging.so does
# not match the platform. The fmi/1 protocol requires stdout to contain exactly
# one JSON reply, so keep imports and runner diagnostics on stderr.
cat > "$OPENSYSML_HOME/bin/opensysml-fmi-runner" <<'PY'
#!/opt/opensysml/venv/bin/python
import contextlib, json, sys
with contextlib.redirect_stdout(sys.stderr):
    from opensysml.fmi_runner import run
    request = json.load(sys.stdin)
    response = run(request)
print(json.dumps(response))
PY
chmod 0755 "$OPENSYSML_HOME/bin/opensysml-fmi-runner"

# A live check, not a file that merely exists: import both libraries, then ask
# the service binary for its version with the wrapper's stdout discipline.
OPENSYSML_BINARY="$OPENSYSML_HOME/bin/sysml-grpc" "$OPENSYSML_HOME/venv/bin/python" - <<'PY'
import contextlib, sys
with contextlib.redirect_stdout(sys.stderr):
    import opensysml, fmpy
print('opensysml', opensysml.__version__, 'fmpy', fmpy.__version__)
PY
"$OPENSYSML_HOME/bin/sysml-grpc" --version

cat > "$OPENSYSML_HOME/manifest.json" <<JSON
{"schema":"daidalis-sysml-sim-v1","version":"${OPENSYSML_VERSION}","asset":"${asset}","sha256":"${digest}","pythonPackage":"${PYTHON_PACKAGE_VERSION}"}
JSON
printf '%s\n' 'OpenSysML and FMPy are installed for the SysML FMI backend.'
