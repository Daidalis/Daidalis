#!/usr/bin/env python3
"""Preview or apply the one-time deployment-name configuration migration.

This tool only changes local configuration files. It never starts/stops a
container, creates/removes a volume, rewrites project data, or prints values.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


KEY = re.compile(r'^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$')
PROJECT = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
LOGICAL_VOLUMES = frozenset(('state', 'projects', 'home', 'desktop-control',
    'desktop-data', 'model-control', 'broker-control', 'flight-control', 'flight-runtime'))
OVERRIDE = 'deploy/local/name-migration.compose.yaml'


def new_key(name):
    for prefix in ('MANTA_', 'MBSE_', 'SYSPILOT_'):
        if name.startswith(prefix):
            return 'DAIDALIS_' + name[len(prefix):]
    return name


def migrate_environment(text, *, append_override=False, project=None):
    """Return migrated text and key names; conflicting aliases fail closed."""
    lines = text.splitlines(keepends=True)
    values = {}
    for line in lines:
        match = KEY.match(line.rstrip('\r\n'))
        if match:
            name, value = new_key(match[2]), match[4]
            if name in values and values[name] != value:
                raise ValueError('Conflicting configuration entries for ' + name)
            values[name] = value
    changes, output, written = [], [], set()
    for line in lines:
        match = KEY.match(line.rstrip('\r\n'))
        if not match:
            output.append(line)
            continue
        name = new_key(match[2])
        if name in written:
            changes.append(match[2])
            continue
        written.add(name)
        value = match[4]
        if name in ('DAIDALIS_IMAGE', 'DAIDALIS_TASK_IMAGE', 'DAIDALIS_TASK_FLIGHT_IMAGE'):
            replacement = re.sub(r'^(manta-(?:app|broker|flight|nos3-sdk|nos3-native-repro))(?=:|@|$)',
                                 lambda item: item[0].replace('manta-', 'daidalis-', 1), value)
            if replacement != value:
                value = replacement
                changes.append(name)
        if append_override and name == 'COMPOSE_FILE':
            if any(character in value for character in ('"', "'", '$', '#', '\\')):
                raise ValueError('COMPOSE_FILE must contain plain application-relative paths')
            paths = value.split(':')
            if OVERRIDE not in paths:
                value += ':' + OVERRIDE
                changes.append(name)
        if name != match[2]:
            changes.append(match[2])
        ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
        output.append(match[1] + name + match[3] + value + ending)
    if append_override and 'COMPOSE_FILE' not in written:
        if output and not output[-1].endswith(('\n', '\r')):
            output.append('\n')
        output.append('COMPOSE_FILE=compose.yaml:' + OVERRIDE + '\n')
        changes.append('COMPOSE_FILE')
    if project and 'COMPOSE_PROJECT_NAME' not in written:
        if output and not output[-1].endswith(('\n', '\r')):
            output.append('\n')
        output.append('COMPOSE_PROJECT_NAME=' + project + '\n')
        changes.append('COMPOSE_PROJECT_NAME')
    return ''.join(output), sorted(set(changes))


def read_project(text):
    for line in text.splitlines():
        match = KEY.match(line)
        if match and match[2] == 'COMPOSE_PROJECT_NAME':
            candidate = match[4].strip().strip('"\'')
            if not PROJECT.fullmatch(candidate):
                raise ValueError('Invalid saved Compose project name')
            return candidate
    return None


def explicit_broker_settings(texts):
    """Read only deployment identities; never include credentials in the result."""
    settings = {}
    for text in texts:
        for line in text.splitlines():
            match = KEY.match(line)
            if not match:
                continue
            name = new_key(match[2])
            if name not in ('DAIDALIS_BROKER_ID', 'DAIDALIS_TASK_PROJECTS_VOLUME', 'DAIDALIS_MODEL_VOLUME'):
                continue
            value = match[4].strip().strip('"\'')
            if not value:
                continue
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', value):
                raise ValueError('Unsupported explicit deployment identity for ' + name)
            if name in settings and settings[name] != value:
                raise ValueError('Conflicting configuration entries for ' + name)
            settings[name] = value
    return settings


def compose_volume_override(volumes, project, settings=None):
    """Pin existing volumes rather than allowing Compose to allocate empty ones."""
    settings = settings or {}
    mapping = {}
    for volume in volumes:
        labels = volume.get('Labels') or {}
        if labels.get('com.docker.compose.project') != project:
            continue
        logical = labels.get('com.docker.compose.volume')
        if logical not in LOGICAL_VOLUMES:
            continue
        if logical in mapping and mapping[logical] != volume['Name']:
            raise ValueError('Multiple existing volumes for ' + logical)
        mapping[logical] = volume['Name']
    for logical, key in (('projects', 'DAIDALIS_TASK_PROJECTS_VOLUME'), ('model-control', 'DAIDALIS_MODEL_VOLUME')):
        configured = settings.get(key)
        if configured:
            if logical in mapping and configured != mapping[logical]:
                raise ValueError('Configured volume differs from discovered deployment volume for ' + key)
            if not any(volume['Name'] == configured for volume in volumes):
                raise ValueError('Configured deployment volume was not found for ' + key)
            mapping[logical] = configured
    if not mapping:
        return '', mapping
    result = {'volumes': {key: {'external': True, 'name': value}
                           for key, value in sorted(mapping.items())}}
    if 'projects' in mapping:
        result['services'] = {'broker': {'environment': {
            'DAIDALIS_TASK_PROJECTS_VOLUME': mapping['projects'],
            'DAIDALIS_BROKER_ID': settings.get('DAIDALIS_BROKER_ID', project)}}}
        if 'model-control' in mapping:
            result['services']['broker']['environment']['DAIDALIS_MODEL_VOLUME'] = mapping['model-control']
    # JSON is a YAML subset accepted by Compose; no extra host dependency needed.
    return json.dumps(result, ensure_ascii=False, indent=2) + '\n', mapping


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('Refusing to replace a configuration symlink')
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--project', help='Existing Compose project; defaults to saved project or the former default')
    parser.add_argument('--apply', action='store_true', help='Back up and write the displayed configuration changes')
    parser.add_argument('--skip-docker', action='store_true', help='Migrate configuration keys only, without volume discovery')
    options = parser.parse_args()
    root = options.root.resolve()
    names = ['.env', 'deploy/local/install.env', 'deploy/local/broker.env']
    originals = {}
    for name in names:
        path = root / name
        if path.is_symlink():
            raise ValueError('Refusing a configuration symlink: ' + name)
        if path.is_file():
            originals[name] = path.read_text()
    projects = {p for text in originals.values() if (p := read_project(text))}
    if len(projects) > 1 and not options.project:
        raise ValueError('Several saved deployments exist; select one with --project')
    project = options.project or next(iter(projects), 'manta')
    if not PROJECT.fullmatch(project):
        raise ValueError('Invalid existing Compose project name')
    if options.project:
        originals = {name: text for name, text in originals.items()
                     if read_project(text) in (None, project)}
    volumes = []
    settings = explicit_broker_settings(originals.values())
    if not options.skip_docker:
        listed = subprocess.check_output(['docker', 'volume', 'ls', '--filter',
            'label=com.docker.compose.project=' + project, '--format', '{{.Name}}'], text=True).splitlines()
        listed = sorted(set(listed) | {settings[key] for key in ('DAIDALIS_TASK_PROJECTS_VOLUME', 'DAIDALIS_MODEL_VOLUME') if key in settings})
        if listed:
            volumes = json.loads(subprocess.check_output(['docker', 'volume', 'inspect', *listed], text=True))
    override, mapping = ('', {}) if options.skip_docker else compose_volume_override(volumes, project, settings)
    # A shared deployment has no broker service. Add its environment override only
    # for a broker configuration, otherwise Compose would invent that service.
    broker_configured = any(
        Path(file).name == 'compose.broker.yaml'
        for text in originals.values() for line in text.splitlines()
        if (match := KEY.match(line)) and match[2] == 'COMPOSE_FILE'
        for file in match[4].strip().strip('"\'').split(':'))
    if override and not broker_configured:
        decoded = json.loads(override)
        decoded.pop('services', None)
        override = json.dumps(decoded, ensure_ascii=False, indent=2) + '\n'
    plans, changes = {}, {}
    if override and not originals:
        originals['.env'] = ''
    for name, text in originals.items():
        rewritten, keys = migrate_environment(text, append_override=bool(override), project=project if override else None)
        if rewritten != text:
            plans[name] = rewritten
            changes[name] = keys
    if override:
        target = root / OVERRIDE
        if target.is_symlink():
            raise ValueError('Refusing a migration override symlink')
        if target.exists() and target.read_text() != override:
            raise ValueError('An existing volume override differs; inspect it before replacing')
        if not target.exists():
            plans[OVERRIDE] = override
    # Validate every backup conflict before writing anything.
    for name in plans:
        path = root / name
        backup = path.with_name(path.name + '.before-daidalis')
        if path.exists() and backup.exists() and (backup.is_symlink() or not backup.is_file()):
            raise ValueError('Unsafe existing backup for ' + name)
    print(json.dumps({'mode': 'apply' if options.apply else 'preview', 'project': project,
        'configuration_changes': changes, 'files_to_write': sorted(plans),
        'existing_volumes_reused': mapping,
        'containers_or_volumes_modified': False}, ensure_ascii=False, indent=2))
    if options.apply:
        for name, data in plans.items():
            path = root / name
            backup = path.with_name(path.name + '.before-daidalis')
            if path.exists() and not backup.exists():
                private_write(backup, path.read_text())
            private_write(path, data)


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error))
    except (subprocess.CalledProcessError, OSError):
        # Config values and subprocess arguments may contain access-bearing data.
        raise SystemExit('Name migration could not be applied. Check configuration conflicts, file permissions, and Docker access; original volumes are unchanged.')
