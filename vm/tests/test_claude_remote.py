#!/usr/bin/env python3
"""Credential-free end-to-end checks for the private Claude Linux VM transport.

Run with MANTA_CLAUDE_VM_TEST_SLUG set to an existing isolated project slug.
The tests never read a real API key or contact a model endpoint.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = ROOT / 'host/claude-remote.py'
SLUG = os.environ.get('MANTA_CLAUDE_VM_TEST_SLUG')
ENV = {
    'PATH': '/usr/bin:/bin:/usr/sbin:/sbin',
    'LANG': 'C.UTF-8',
    'HOME': str(Path.home()),
    'MANTA_REMOTE_PROJECT_SLUG': SLUG or '',
}
SDK_ARGS = [
    '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
    '--max-turns=1', '--model=claude-haiku-5-5', '--permission-prompt-tool=stdio',
    '--disallowedTools=Agent,Task,Bash,WebFetch,WebSearch', '--tools=default',
    '--setting-sources=', '--permission-mode=default', '--settings',
    '{"apiKeyHelper":"/opt/claude/key-helper"}',
]
GUEST_ENV = {
    'ANTHROPIC_BASE_URL': 'http://127.0.0.1:9',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1',
    'CLAUDE_AGENT_SDK_VERSION': '0.3.307',
    'CLAUDE_CODE_ENTRYPOINT': 'sdk-ts',
    'CLAUDE_CODE_SDK_READS_SESSION_STATE': '1',
}


@unittest.skipUnless(SLUG, 'Set MANTA_CLAUDE_VM_TEST_SLUG for live VM checks')
class ClaudeTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        staged = subprocess.run(['/usr/bin/python3', str(TRANSPORT), '--stage'],
                                env=ENV, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=30)
        assert staged.returncode == 0, 'Cannot stage fixed private guest launcher'

    def test_readiness_has_project_only_mounts_and_private_secret(self):
        result = subprocess.run(['/usr/bin/python3', str(TRANSPORT), '--probe'],
                                env=ENV, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=30)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertTrue(data['ready'])
        self.assertEqual(data['isolation']['cwd'], '/work')
        self.assertEqual(data['isolation']['privateSecretMode'], '0o600')
        self.assertTrue(data['isolation']['helperWorks'])
        self.assertTrue(data['isolation']['projectVisible'])
        self.assertFalse(any(data['isolation']['hiddenPathsVisible'].values()))

    def test_bidirectional_stdio_is_exact_across_pipe_boundaries(self):
        payload = bytes((index * 17 + 3) % 256 for index in range(240003))
        result = subprocess.run(['/usr/bin/python3', str(TRANSPORT), '--transport-probe'],
                                input=payload, env=ENV, capture_output=True, timeout=40)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, payload)

    def test_unlisted_guest_environment_is_rejected(self):
        # No key is sent: the first frame must be rejected before the secret.
        header = {'args': SDK_ARGS, 'env': {**GUEST_ENV, 'HOME': '/Users/example'}}
        result = subprocess.run(['/usr/bin/python3', str(TRANSPORT)],
                                input=(json.dumps(header) + '\n').encode(), env=ENV,
                                capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b'')

    def test_zero_length_private_frame_is_rejected(self):
        header = {'args': SDK_ARGS, 'env': GUEST_ENV}
        payload = (json.dumps(header) + '\n').encode() + b'\0\0\0\0'
        result = subprocess.run(['/usr/bin/python3', str(TRANSPORT)],
                                input=payload, env=ENV, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b'')

    def test_sigterm_closes_transport_promptly(self):
        child = subprocess.Popen(['/usr/bin/python3', str(TRANSPORT), '--transport-probe'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=ENV)
        try:
            time.sleep(1)
            child.send_signal(signal.SIGTERM)
            child.communicate(timeout=8)
            self.assertIsNotNone(child.returncode)
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()


if __name__ == '__main__':
    unittest.main()
