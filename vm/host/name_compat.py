#!/usr/bin/python3
"""Closed name profiles for existing VM disks; never rewrite their contents."""
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile


CURRENT = dict(user='daidalis', alias='daidalis-nos3-local-vm',
    root='/srv/daidalis', transfer='/mnt/daidalis-transfer', home='/home/daidalis',
    tag='daidalis-transfer', runtime_prefix='daidalis-vm', binary='daidalis-vm',
    ready_schema='daidalis-nos3-native-ready-v1')
LEGACY = dict(user='manta', alias='manta-nos3-local-vm',
    root='/srv/manta', transfer='/mnt/manta-transfer', home='/home/manta',
    tag='manta-transfer', runtime_prefix='manta-vm', binary='manta-vm',
    ready_schema='manta-nos3-native-ready-v1')


def profile(state):
    state = Path(state).resolve()
    explicit = state / 'name-profile.json'
    if explicit.is_symlink():
        raise ValueError('VM name profile must not be a symlink')
    if explicit.exists():
        value = json.loads(explicit.read_text())
        if value not in (CURRENT, LEGACY):
            raise ValueError('VM name profile must match a supported fixed profile')
        return dict(value)
    for name in ('native-ready.json', 'runtime.json'):
        file = state / name
        if file.is_file():
            saved = json.loads(file.read_text())
            if saved.get('schema') == LEGACY['ready_schema'] or saved.get('guestUser') == LEGACY['user']:
                return dict(LEGACY)
            if saved.get('schema') == CURRENT['ready_schema'] or saved.get('guestUser') == CURRENT['user']:
                return dict(CURRENT)
    seed = state / 'seed/user-data'
    if seed.is_file() and ('name: ' + LEGACY['user']) in seed.read_text():
        return dict(LEGACY)
    return dict(CURRENT)


def guest_command(command, selected):
    """Translate only the app-owned absolute path roots in a fixed SSH command."""
    for key in ('root', 'transfer', 'home'):
        command = command.replace(CURRENT[key], selected[key])
    return command


def save_profile(state, selected):
    """Pin disk identity before newer readiness receipts replace old metadata."""
    if selected not in (CURRENT, LEGACY):
        raise ValueError('Unsupported VM name profile')
    target = Path(state).resolve() / 'name-profile.json'
    if target.exists() or target.is_symlink():
        if profile(state) != selected:
            raise ValueError('Existing VM name profile changed')
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.name-profile-', dir=target.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(json.dumps(selected, sort_keys=True) + '\n')
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            if profile(state) != selected:
                raise ValueError('Existing VM name profile changed')
    finally:
        os.unlink(temporary)


def ssh_command(command, selected):
    """Pass only fixed name-profile paths, preserving the pinned program bytes."""
    if selected not in (CURRENT, LEGACY):
        raise ValueError('Unsupported VM name profile')
    exports = ' '.join('DAIDALIS_VM_' + key.upper() + '=' + shlex.quote(selected[key])
                       for key in ('root', 'transfer', 'home', 'user'))
    return 'export ' + exports + '; ' + guest_command(command, selected)


if __name__ == '__main__':
    selected = profile(sys.argv[1])
    if sys.argv[2:] == ['--shell']:
        for key, value in selected.items():
            print('DAIDALIS_VM_' + key.upper() + '=' + shlex.quote(value))
        print('export DAIDALIS_VM_TAG DAIDALIS_VM_RUNTIME_PREFIX')
    elif sys.argv[2:] == ['--save-profile']:
        save_profile(sys.argv[1], selected)
    elif len(sys.argv) == 4 and sys.argv[2] == '--command':
        print(guest_command(sys.argv[3], selected))
    elif len(sys.argv) == 4 and sys.argv[2] == '--ssh-command':
        print(ssh_command(sys.argv[3], selected))
    elif len(sys.argv) >= 4 and sys.argv[2] == '--ssh-argv':
        print(ssh_command(shlex.join(sys.argv[3:]), selected))
    elif len(sys.argv) == 4 and sys.argv[2] == '--field':
        print(selected[sys.argv[3]])
    else:
        print(json.dumps(selected, sort_keys=True))
