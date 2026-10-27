#!/usr/bin/python3
"""Private local sockets and signed executable cache for a NAS-backed VM."""
import fcntl
import hashlib
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import tempfile


def runtime_directory(state):
    canonical = str(Path(state).resolve())
    digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]
    return Path('/private/tmp') / f'manta-vm-{os.getuid()}-{digest}'


def private_directory(directory):
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Manta VM communication directory must be private and owned by this user')
    return directory


def prepare_runtime(state):
    return private_directory(runtime_directory(state))


def file_digest(path):
    with path.open('rb') as handle:
        h = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_executable(path):
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    result = subprocess.run(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(path)], check=True, capture_output=True)
    entitlement = plistlib.loads(result.stdout)
    if entitlement.get('com.apple.security.virtualization') is not True:
        raise RuntimeError('Manta VM executable lacks the Virtualization entitlement')


def cached_executable(state):
    state = Path(state).resolve()
    source = state.parent / 'host/manta-vm'
    info = source.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 16 * 1024 * 1024:
        raise RuntimeError('Manta VM executable must be a regular application-owned file')
    digest = file_digest(source)
    cache = private_directory(prepare_runtime(state) / 'executables')
    version = private_directory(cache / digest)
    destination = version / 'manta-vm'
    lockfd = os.open(str(cache / '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lockfd, 'a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if destination.exists() or destination.is_symlink():
            saved = destination.lstat()
            if not stat.S_ISREG(saved.st_mode) or saved.st_uid != os.getuid() or stat.S_IMODE(saved.st_mode) != 0o700:
                raise RuntimeError('Unsafe cached VM executable')
            if file_digest(destination) != digest:
                raise RuntimeError('Cached VM executable content mismatch')
            verify_executable(destination)
            return destination
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=version, prefix='.manta-', delete=False) as output:
                temporary = Path(output.name)
                with source.open('rb') as incoming:
                    for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                        output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if file_digest(temporary) != digest:
                raise RuntimeError('VM executable changed while caching')
            temporary.chmod(0o700)
            verify_executable(temporary)
            os.replace(temporary, destination)
            return destination
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()


def process_path_matches(state, command, arguments):
    state = Path(state).resolve()
    original = state.parent / 'host/manta-vm'
    if command != str(original):
        cache = runtime_directory(state) / 'executables'
        try:
            relative = Path(command).relative_to(cache)
        except ValueError:
            return False
        if len(relative.parts) != 2 or re.fullmatch(r'[a-f0-9]{64}', relative.parts[0]) is None or relative.parts[1] != 'manta-vm':
            return False
    return arguments == command + ' ' + str(state / 'config.json')


def owns_process(state, pid):
    if not re.fullmatch(r'[0-9]+', str(pid)) or int(pid) <= 1:
        return False
    def field(name):
        result = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', name + '='], capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else ''
    command = field('comm')
    if not command or not process_path_matches(state, command, field('args')):
        return False
    if command != str(Path(state).resolve().parent / 'host/manta-vm'):
        cached = Path(command)
        info = cached.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            return False
        if file_digest(cached) != cached.parent.name:
            return False
    return True


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2:
            print(prepare_runtime(sys.argv[1]) / 'ssh.sock')
        elif len(sys.argv) == 3 and sys.argv[1] == '--executable':
            print(cached_executable(sys.argv[2]))
        elif len(sys.argv) == 4 and sys.argv[1] == '--owns-process':
            raise SystemExit(0 if owns_process(sys.argv[2], sys.argv[3]) else 1)
        else:
            raise SystemExit('Usage: vm-runtime.py STATE | --executable STATE | --owns-process STATE PID')
    except Exception as error:
        raise SystemExit('Manta VM runtime: ' + str(error))
