#!/usr/bin/python3
"""Check local-only communication paths without starting or changing a VM."""
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('vm_runtime', Path(__file__).with_name('vm-runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(tempfile.mkdtemp(prefix='manta-vm-runtime-test-'))
        self.state = self.workspace / 'a very long NAS path 毕业后' / 'state'
        self.state.mkdir(parents=True)
        self.local = runtime.runtime_directory(self.state)

    def tearDown(self):
        if self.local.is_symlink():
            self.local.unlink()
        elif self.local.exists():
            shutil.rmtree(self.local)
        shutil.rmtree(self.workspace)

    def test_socket_is_short_local_private_and_usable(self):
        directory = runtime.prepare_runtime(self.state)
        self.assertEqual(directory.parent, Path('/private/tmp'))
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        address = str(directory / 'ssh.sock')
        self.assertLess(len(address.encode('utf-8')), 104)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(address)
            server.listen()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect(address)
                incoming, _ = server.accept()
                with incoming:
                    client.sendall(b'manta')
                    self.assertEqual(incoming.recv(5), b'manta')
        self.assertFalse((self.state / 'ssh.sock').exists())

    def test_canonical_alias_uses_same_socket(self):
        alias = self.workspace / 'alias'
        alias.symlink_to(self.state, target_is_directory=True)
        self.assertEqual(runtime.runtime_directory(alias), self.local)

    def test_distinct_vm_roots_are_isolated(self):
        self.assertNotEqual(runtime.runtime_directory(self.state / 'other'), self.local)

    def test_symlink_control_directory_is_rejected(self):
        self.local.symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            runtime.prepare_runtime(self.state)

    def test_shared_control_directory_is_rejected(self):
        self.local.mkdir(mode=0o755)
        self.local.chmod(0o755)
        with self.assertRaises(RuntimeError):
            runtime.prepare_runtime(self.state)

    @unittest.skipUnless(os.environ.get('MANTA_TEST_VM_BINARY'), 'set MANTA_TEST_VM_BINARY to a freshly compiled VM binary')
    def test_swift_and_python_resolve_identically(self):
        binary = os.environ['MANTA_TEST_VM_BINARY']
        paths = [self.state, self.workspace / 'other-state']
        alias = self.workspace / 'swift-alias'
        alias.symlink_to(self.state, target_is_directory=True)
        paths.append(alias)
        for state in paths:
            actual = subprocess.check_output([binary, '--socket-path', str(state)], text=True).strip()
            self.assertEqual(actual, str(runtime.runtime_directory(state) / 'ssh.sock'), str(state))


if __name__ == '__main__':
    unittest.main()
