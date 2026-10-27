#!/usr/bin/env python3
"""Opaque SSH stdio transport for one isolated Claude Code project.

The SDK sends a non-secret JSON header, a separate length-prefixed secret
frame, then its native JSONL protocol on stdin. This process does not parse or
log any of those bytes. The guest launcher validates the frames before it
starts the pinned CLI in Bubblewrap.
"""
import os
import pathlib
import re
import hashlib
import shlex
import signal
import subprocess
import sys
import threading


BASE = pathlib.Path(__file__).resolve().parent.parent
STATE = BASE / 'state'
SLUG = os.environ.get('MANTA_REMOTE_PROJECT_SLUG', '')
if not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', SLUG):
    raise SystemExit('Missing isolated project identifier')
MODE = sys.argv[1:]
if MODE not in ([], ['--probe'], ['--stage'], ['--transport-probe']):
    raise SystemExit('Only fixed Claude transport and its readiness checks are supported')

SOCKET = subprocess.check_output(
    ['/usr/bin/python3', str(BASE / 'host/vm-runtime.py'), str(STATE)],
    text=True,
).strip()
SSH_OPTIONS = [
    '-F', '/dev/null', '-T', '-i', str(STATE / 'id_ed25519'),
    '-o', f'ProxyCommand=/usr/bin/nc -U {SOCKET}',
    '-o', f'UserKnownHostsFile={STATE}/known_hosts',
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'HostKeyAlias=manta-nos3-local-vm',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
]
# The SSH process never inherits model credentials or host-wide agent settings.
SSH_ENV = {
    'PATH': '/usr/bin:/bin:/usr/sbin:/sbin',
    'LANG': 'C.UTF-8',
    'HOME': os.path.expanduser('~'),
    'MANTA_REMOTE_PROJECT_SLUG': SLUG,
}
COMMAND = ('python3 /srv/manta/agent-eval/claude/claude-remote-launch.py '
           + ('--probe ' if MODE == ['--probe'] else '--transport-probe ' if MODE == ['--transport-probe'] else '') + SLUG)
LOCAL_LAUNCHER = BASE / 'worker/claude-remote-launch.py'
if not LOCAL_LAUNCHER.is_file() or LOCAL_LAUNCHER.is_symlink():
    raise SystemExit('Pinned Claude worker source is unavailable')
launcher_source = LOCAL_LAUNCHER.read_bytes()
EXPECTED_LAUNCHER_SHA256 = hashlib.sha256(launcher_source).hexdigest()
if MODE == ['--stage']:
    # This explicit maintenance mode copies only the reviewed local worker,
    # verifies it inside the VM, then atomically replaces its private copy.
    installer = (
        'import hashlib,os,pathlib,sys,tempfile; '
        'p=pathlib.Path("/srv/manta/agent-eval/claude/claude-remote-launch.py"); '
        'd=p.parent; s=d.stat(); '
        'assert not d.is_symlink() and d.resolve()==d and s.st_uid==os.getuid() and not s.st_mode&0o077; '
        'b=sys.stdin.buffer.read(1048577); '
        'assert len(b)<=1048576 and hashlib.sha256(b).hexdigest()==sys.argv[1]; '
        'f,n=tempfile.mkstemp(dir=d,prefix=".claude-launcher-"); '
        'os.fchmod(f,0o700); os.write(f,b); os.fsync(f); os.close(f); '
        'os.replace(n,p); print(sys.argv[1])'
    )
    staged = subprocess.run(
        ['/usr/bin/ssh', *SSH_OPTIONS, 'manta@localhost',
         'python3 -c ' + shlex.quote(installer) + ' ' + EXPECTED_LAUNCHER_SHA256],
        input=launcher_source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=SSH_ENV, timeout=30,
    )
    if staged.returncode or staged.stdout.strip().decode('ascii', errors='ignore') != EXPECTED_LAUNCHER_SHA256:
        raise SystemExit('Could not stage the pinned Claude worker in the private VM')
    raise SystemExit(0)
# The VM's shared transfer mount is a snapshot. Refuse to run a stale private
# launcher after the source changes; staging is an explicit, atomic operation.
check = subprocess.run(
    ['/usr/bin/ssh', *SSH_OPTIONS, 'manta@localhost',
     'sha256sum /srv/manta/agent-eval/claude/claude-remote-launch.py'],
    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL, env=SSH_ENV, timeout=20,
)
if check.returncode or check.stdout.split(b' ', 1)[0].decode('ascii', errors='ignore') != EXPECTED_LAUNCHER_SHA256:
    raise SystemExit('Private Claude launcher differs from the reviewed source; stage the pinned worker before use')
CHILD = subprocess.Popen(
    ['/usr/bin/ssh', *SSH_OPTIONS, 'manta@localhost', COMMAND],
    stdin=subprocess.DEVNULL if MODE == ['--probe'] else subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=SSH_ENV,
)


def relay(source, target, close=False):
    try:
        while True:
            chunk = os.read(source.fileno(), 65536)
            if not chunk:
                break
            target.write(chunk)
            target.flush()
    except (BrokenPipeError, OSError):
        pass
    finally:
        if close:
            try:
                target.close()
            except OSError:
                pass


def discard_stderr():
    # Neither SSH nor the CLI gets to publish an accidental credential in a
    # diagnostic. The exit status remains visible to the caller.
    while os.read(CHILD.stderr.fileno(), 65536):
        pass


def terminate(_signum, _frame):
    CHILD.terminate()


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)
try:
    outgoing = None
    if CHILD.stdin is not None:
        outgoing = threading.Thread(
            target=relay, args=(sys.stdin.buffer, CHILD.stdin, True), daemon=True
        )
        outgoing.start()
    errors = threading.Thread(target=discard_stderr, daemon=True)
    errors.start()
    relay(CHILD.stdout, sys.stdout.buffer)
    status = CHILD.wait()
    if outgoing is not None:
        outgoing.join(timeout=1)
    errors.join(timeout=1)
    if status and MODE == ['--probe']:
        print('Isolated Claude probe failed', file=sys.stderr)
    elif status:
        print('Isolated Claude CLI exited unsuccessfully', file=sys.stderr)
    raise SystemExit(status)
finally:
    if CHILD.poll() is None:
        CHILD.terminate()
