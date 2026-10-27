#!/usr/bin/python3
"""Execute the small native shell locally while keeping its project on NAS."""
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile


def prepare(binary, source_root, temporary_root='/private/tmp'):
    binary = Path(binary)
    root = str(Path(source_root).resolve())
    namespace = hashlib.sha256(root.encode()).hexdigest()[:20]
    directory = Path(temporary_root) / ('manta-app-%s-%s' % (os.getuid(), namespace))
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Manta temporary executable directory is not private')
    content = binary.read_bytes()
    expected = hashlib.sha256(content).digest()
    target = directory / 'Manta'
    try:
        current = target.lstat()
    except FileNotFoundError:
        current = None
    if current:
        if not stat.S_ISREG(current.st_mode) or current.st_uid != os.getuid() or current.st_mode & 0o077:
            raise RuntimeError('Invalid Manta cached executable')
        if hashlib.sha256(target.read_bytes()).digest() == expected and current.st_mode & stat.S_IXUSR:
            return target
    fd, name = tempfile.mkstemp(prefix='.Manta-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, 0o700)
        if hashlib.sha256(Path(name).read_bytes()).digest() != expected:
            raise RuntimeError('Manta executable cache verification failed')
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return target


if __name__ == '__main__':
    executable = prepare(sys.argv[1], sys.argv[2])
    os.execv(str(executable), [str(executable)] + sys.argv[3:])
