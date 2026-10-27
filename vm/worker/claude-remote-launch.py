#!/usr/bin/env python3
"""Pinned Claude Code in a one-project Linux Bubblewrap mount namespace.

The first stdin frame is non-secret JSON {args,env}; the second frame is a
four-byte big-endian length followed by a private API key. Only the latter is
copied into a per-turn, read-only 0600 tmpfs file. The fixed apiKeyHelper
reads that file for Claude Code. Neither the key nor its bytes occur in the
CLI argv, environment, persistent home, logs, or an SDK-visible file.
"""
import hashlib
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
from urllib.parse import urlsplit


PROJECTS = pathlib.Path('/mnt/manta-transfer/eval-workspaces')
SESSIONS = pathlib.Path('/srv/manta/agent-eval/sessions')
ASSETS = pathlib.Path('/srv/manta/agent-eval/claude')
CLI = ASSETS / 'claude'
HELPER = ASSETS / 'key-helper'
CLI_SHA256 = '1c67968ab8410c9644e2f4867167a0dab1a8c6c9de9cc83fe78449e5ae8a3633'
HELPER_SHA256 = 'ac438340c670154a5ec4679f4d74e3926e3e317e2e3bcb10ca51eeb1f88543c3'
PACKAGE = '@anthropic-ai/claude-agent-sdk-linux-arm64'
VERSION = '0.3.307'
PACKAGE_INTEGRITY = 'sha512-/6Z3EHVQcOyBA2Fz77QHK6C6h/FTDVWSMQufltekI3wLJXAfiFeG4mhPZJBatFwcR15flsqWVQ+1VilUs+h2Gg=='
MAX_HEADER = 4 * 1024 * 1024
MAX_KEY = 10000
HELPER_GUEST_PATH = '/opt/claude/key-helper'
REQUIRED_DENIED = frozenset(('Agent', 'Task', 'Bash', 'WebFetch', 'WebSearch'))
ENV_ALLOWED = frozenset((
    'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_AGENT_SDK_CLIENT_APP', 'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CODE_SDK_READS_SESSION_STATE',
    'CLAUDE_CODE_SDK_READS_STARTUP_MARKS',
))
ARG_ALLOWED = frozenset((
    '--max-turns', '--model', '--permission-prompt-tool',
    '--disallowedTools', '--tools', '--setting-sources',
    '--permission-mode', '--settings', '--resume',
))


def fail(message):
    raise ValueError(message)


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                return h.hexdigest()
            h.update(block)


def checked_directory(folder, create=False):
    if create:
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if folder.is_symlink() or not folder.is_dir() or folder.resolve(strict=True) != folder:
        fail('Private Claude path is unavailable or redirected')
    return folder


def verify_assets():
    checked_directory(ASSETS)
    if ASSETS.stat().st_uid != os.getuid() or ASSETS.stat().st_mode & 0o077:
        fail('Private Claude assets have unsafe ownership or permissions')
    for item, expected in ((CLI, CLI_SHA256), (HELPER, HELPER_SHA256)):
        if item.is_symlink() or not item.is_file() or digest(item) != expected:
            fail('Pinned Claude asset integrity mismatch')
        if not os.access(item, os.X_OK):
            fail('Pinned Claude asset is not executable')
    receipt = json.loads((ASSETS / 'receipt.json').read_text())
    if (receipt.get('schema') != 'manta-claude-native-asset-v1'
            or receipt.get('package') != PACKAGE or receipt.get('version') != VERSION
            or receipt.get('npmIntegrity') != PACKAGE_INTEGRITY
            or receipt.get('binarySha256') != CLI_SHA256
            or receipt.get('binaryBytes') != CLI.stat().st_size):
        fail('Pinned Claude asset receipt mismatch')
    if not pathlib.Path('/usr/bin/bwrap').is_file():
        fail('Guest Bubblewrap is unavailable')


def project_paths(slug):
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', slug):
        fail('Invalid isolated project identifier')
    checked_directory(PROJECTS)
    workspace = checked_directory(PROJECTS / slug)
    if workspace.parent != PROJECTS:
        fail('Project folder escaped the isolated workspace root')
    checked_directory(SESSIONS)
    session = checked_directory(SESSIONS / slug, create=True)
    (session / '.claude').mkdir(mode=0o700, exist_ok=True)
    checked_directory(session / '.claude')
    return workspace, session


def _arg_pair(args, index):
    arg = args[index]
    if '=' in arg:
        name, value = arg.split('=', 1)
        return name, value, index + 1
    if index + 1 >= len(args):
        fail('Claude CLI option lacks a value')
    return arg, args[index + 1], index + 2


def validate_args(args):
    if not isinstance(args, list) or len(args) < 5 or len(args) > 64:
        fail('Invalid Claude SDK argument list')
    if any(not isinstance(a, str) or len(a) > 1024 * 1024 or '\0' in a or '\n' in a or '\r' in a for a in args):
        fail('Invalid Claude SDK argument value')
    if args[:5] != ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json']:
        fail('Claude SDK stream-json protocol is required')
    seen = {}
    index = 5
    while index < len(args):
        arg = args[index]
        if arg == '--include-partial-messages':
            if arg in seen:
                fail('Duplicate Claude CLI option')
            seen[arg] = True
            index += 1
            continue
        name, value, index = _arg_pair(args, index)
        if name not in ARG_ALLOWED or name in seen:
            fail('Claude CLI option is not permitted')
        seen[name] = value
    if seen.get('--permission-prompt-tool') != 'stdio':
        fail('Claude SDK stdio permission callback is required')
    if seen.get('--tools') != 'default' or seen.get('--setting-sources') != '':
        fail('Claude SDK tool and settings isolation is required')
    if seen.get('--permission-mode') not in ('default', 'auto'):
        fail('Claude permission mode is unsupported')
    if not REQUIRED_DENIED.issubset(set(seen.get('--disallowedTools', '').split(','))):
        fail('Claude native network and subagent tools must be disabled')
    try:
        settings = json.loads(seen.get('--settings', ''))
    except (TypeError, ValueError):
        fail('Claude settings must pin the credential helper')
    if settings != {'apiKeyHelper': HELPER_GUEST_PATH}:
        fail('Claude settings changed the credential helper or added a setting')
    if '--max-turns' in seen and (not seen['--max-turns'].isdigit() or not 1 <= int(seen['--max-turns']) <= 128):
        fail('Claude max turns is outside the isolated budget')
    if '--model' in seen and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}', seen['--model']):
        fail('Claude model identifier is invalid')
    if '--resume' in seen and not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', seen['--resume']):
        fail('Claude resume identifier is invalid')
    return args


def validate_env(value):
    if not isinstance(value, dict) or set(value) - ENV_ALLOWED:
        fail('Claude guest environment contains an unsupported name')
    if any(not isinstance(v, str) or len(v) > 2000 or '\0' in v or '\n' in v or '\r' in v for v in value.values()):
        fail('Claude guest environment contains an invalid value')
    if value.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC') != '1':
        fail('Claude nonessential traffic must be disabled')
    if value.get('CLAUDE_AGENT_SDK_VERSION') not in (None, VERSION):
        fail('Claude SDK version does not match the pinned CLI')
    if value.get('CLAUDE_CODE_ENTRYPOINT') not in (None, 'sdk-ts'):
        fail('Claude SDK entrypoint is not pinned')
    for name in ('CLAUDE_CODE_SDK_READS_SESSION_STATE', 'CLAUDE_CODE_SDK_READS_STARTUP_MARKS'):
        if value.get(name) not in (None, '1'):
            fail('Claude SDK state marker is not pinned')
    if value.get('ANTHROPIC_BASE_URL'):
        parsed = urlsplit(value['ANTHROPIC_BASE_URL'])
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            fail('Claude endpoint URL is invalid')
    return value


def read_exact(length):
    chunks = []
    while length:
        block = os.read(0, length)
        if not block:
            fail('Incomplete private Claude frame')
        chunks.append(block)
        length -= len(block)
    return b''.join(chunks)


def read_frames():
    header = bytearray()
    while len(header) <= MAX_HEADER:
        char = os.read(0, 1)
        if not char:
            fail('Missing Claude transport header')
        if char == b'\n':
            break
        header.extend(char)
    else:
        fail('Claude transport header exceeds limit')
    try:
        parsed = json.loads(header)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail('Claude transport header is not JSON')
    if not isinstance(parsed, dict) or set(parsed) != {'args', 'env'}:
        fail('Claude transport header requires args and non-secret env')
    args = validate_args(parsed['args'])
    env = validate_env(parsed['env'])
    size = int.from_bytes(read_exact(4), 'big')
    if size < 1 or size > MAX_KEY:
        fail('Private Claude secret frame has invalid length')
    key = bytearray(read_exact(size))
    if any(b < 33 or b > 126 for b in key):
        fail('Private Claude secret frame has invalid bytes')
    return args, env, key


def sandbox_command(workspace, session, secret_fd=None):
    command = ['/usr/bin/bwrap', '--unshare-all', '--share-net', '--die-with-parent', '--new-session']
    for location in ('/usr', '/lib', '/lib64', '/bin', '/etc'):
        if pathlib.Path(location).exists():
            command.extend(('--ro-bind', location, location))
    command.extend((
        '--ro-bind', str(ASSETS), '/opt/claude',
        '--bind', str(workspace), '/work',
        '--bind', str(session), '/home/manta',
        '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
        '--tmpfs', '/run', '--dir', '/run/secrets',
        '--chdir', '/work',
    ))
    if secret_fd is not None:
        command.extend(('--perms', '0600', '--ro-bind-data', str(secret_fd), '/run/secrets/api-key'))
    return command


def guest_environment(header):
    return {
        'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/home/manta',
        'CLAUDE_CONFIG_DIR': '/home/manta/.claude', 'TMPDIR': '/tmp',
        **header,
    }


def probe(workspace, session):
    marker = b'not-a-real-api-key'
    fd = os.memfd_create('manta-claude-probe', os.MFD_CLOEXEC)
    try:
        os.write(fd, marker)
        os.lseek(fd, 0, os.SEEK_SET)
        script = (
            'import json,os,stat,subprocess; '
            'hidden=["/mnt/manta-transfer","/srv/manta","/Volumes","/Users","/home/manta/.ssh"]; '
            'p="/run/secrets/api-key"; '
            'm=stat.S_IMODE(os.stat(p).st_mode); '
            'k=subprocess.check_output(["/opt/claude/key-helper"]); '
            'print(json.dumps({"cwd":os.getcwd(),"projectVisible":os.path.isdir("/work"),'
            '"hiddenPathsVisible":{x:os.path.exists(x) for x in hidden},'
            '"privateSecretMode":oct(m),"helperWorks":k==b"not-a-real-api-key"}))'
        )
        result = subprocess.run(
            sandbox_command(workspace, session, fd) + ['/usr/bin/python3', '-c', script],
            env=guest_environment({'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}),
            pass_fds=(fd,), stdin=subprocess.DEVNULL, capture_output=True, timeout=20,
        )
        if result.returncode:
            fail('Claude Bubblewrap isolation probe failed')
        observation = json.loads(result.stdout)
        if observation.get('cwd') != '/work' or not observation.get('projectVisible') or observation.get('privateSecretMode') != '0o600' or not observation.get('helperWorks') or any(observation.get('hiddenPathsVisible', {}).values()):
            fail('Claude Bubblewrap isolation probe detected an exposed path or key file')
        version = subprocess.run(
            sandbox_command(workspace, session) + ['/opt/claude/claude', '--version'],
            env=guest_environment({'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}),
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10,
        )
        if version.returncode or 'Claude Code' not in version.stdout:
            fail('Pinned Claude CLI cannot start in this Linux guest')
        print(json.dumps({'ready': True, 'runtime': 'claude-agent-sdk', 'cliVersion': version.stdout.strip(),
                          'cliSha256': CLI_SHA256, 'isolation': observation}, sort_keys=True))
    finally:
        os.close(fd)


def launch(workspace, session):
    args, header_env, key = read_frames()
    fd = os.memfd_create('manta-claude-key', os.MFD_CLOEXEC)
    try:
        os.write(fd, key)
        os.lseek(fd, 0, os.SEEK_SET)
        key[:] = b'\0' * len(key)
        child = subprocess.Popen(
            sandbox_command(workspace, session, fd) + ['/opt/claude/claude', *args],
            env=guest_environment(header_env), pass_fds=(fd,),
            stdin=0, stdout=1, stderr=2,
        )
    finally:
        os.close(fd)

    def stop(_signum, _frame):
        child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    return child.wait()


def transport_probe(workspace, session):
    # No model or credential is loaded. This exercises the same SSH and
    # Bubblewrap stdio path used by the SDK with a bounded byte-for-byte echo.
    script = '''import os,sys
total=0
while True:
    chunk=os.read(0,65536)
    if not chunk:
        break
    total+=len(chunk)
    if total>1048576:
        sys.exit(2)
    view=memoryview(chunk)
    while view:
        view=view[os.write(1,view):]
'''
    child = subprocess.Popen(
        sandbox_command(workspace, session) + ['/usr/bin/python3', '-u', '-c', script],
        env=guest_environment({'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}),
        stdin=0, stdout=1, stderr=2,
    )
    return child.wait()


def main(argv):
    try:
        if argv[:1] == ['--probe']:
            if len(argv) != 2:
                fail('Probe requires one project identifier')
            slug = argv[1]
            verify_assets()
            workspace, session = project_paths(slug)
            probe(workspace, session)
            return 0
        if argv[:1] == ['--transport-probe']:
            if len(argv) != 2:
                fail('Transport probe requires one project identifier')
            verify_assets()
            workspace, session = project_paths(argv[1])
            return transport_probe(workspace, session)
        if len(argv) != 1:
            fail('Claude launcher requires one project identifier')
        verify_assets()
        workspace, session = project_paths(argv[0])
        return launch(workspace, session)
    except (ValueError, OSError, subprocess.TimeoutExpired):
        # Never include exception text: a guest runtime or auth library may
        # accidentally insert a credential into its error message.
        print('Isolated Claude launcher rejected the request', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
