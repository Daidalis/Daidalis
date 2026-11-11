"""Run one SysML-driven FMI simulation inside the isolated task worker.

The model is SysML: a ``calc def`` carrying ``metadata ToolExecution`` with
``toolName = "fmi"``, plus an ``analysis def`` whose ``assert constraint`` is the
verdict. OpenSysML evaluates the analysis through the fmi/1 runner and answers
the final value; FMPy produces the trajectory that the UI plots.

The two must agree. Both are driven from the same experiment, and the runner
records whether the analysis' returned value matches the trajectory's last
sample, so a drifting plot is visible rather than silent.

Invoked by ``worker.professional()`` for ``toolId == 'sysml-fmi'``; also runs as
a standalone command for host-side checks (one JSON request on stdin, one reply
on stdout).
"""

import base64
import contextlib
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

WORK = Path('/work')
MAX_FMU_BYTES = 8 * 1024 * 1024
MAX_TRAJECTORY_ROWS = 20000
MAX_TRAJECTORY_COLUMNS = 32
TOOL_ID = 'sysml-fmi'
OPENSYSML_VERSION = 'v0.12.1'

# ``uri = "file:///abs/path/Model.fmu"`` inside a ToolExecution annotation.
URI = re.compile(r'uri\s*=\s*"(file://[^"]*)"')
# One feature declaration of a calc: ``return x : Real[1] { @ToolVariable {...} }``.
DECLARATION = re.compile(r'(?m)^[ \t]*(?P<role>in|out|return)[ \t]+(?P<feature>[A-Za-z_]\w*)[ \t]*:[^\n]*')
TOOL_VARIABLE = re.compile(r'@ToolVariable\s*\{\s*name\s*=\s*"(?P<variable>[^"]+)"')
DECLARED_DEFAULT = re.compile(r'=\s*(?P<value>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)')
EXPERIMENT_VARIABLES = {
    'fmi:startTime': 'startTime',
    'fmi:stopTime': 'stopTime',
    'fmi:stepSize': 'stepSize',
    'fmi:tolerance': 'tolerance',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tool_home():
    return Path(os.environ.get('SYML_FMI_HOME') or '/opt/opensysml')


def _require_relative(name):
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name:
        raise ValueError('Invalid relative file path')
    if PurePosixPath(name).is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError('File path escapes the job workspace')
    return name


def materialize(files, work=None, limit=MAX_FMU_BYTES):
    """Write pinned inputs under ``work`` and check every declared hash."""
    root = Path(work or WORK)
    written = []
    total = 0
    seen = set()
    for entry in files or []:
        name = _require_relative(entry['path'])
        if name in seen:
            raise ValueError('Duplicate input file: ' + name)
        seen.add(name)
        content = base64.b64decode(entry['contentBase64'], validate=True)
        total += len(content)
        if total > limit:
            raise ValueError('Input files exceed the size limit')
        if sha(content) != entry.get('sha256'):
            raise ValueError('Input hash mismatch: ' + name)
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        written.append(name)
    return written


def rewrite_uri(text, fmu_path):
    """Point the ToolExecution ``uri`` at the FMU this job actually pinned.

    Only a URI whose basename names this FMU is rewritten, so a model that
    references several tools keeps the others. A model with no matching URI is
    refused: silently simulating a different FMU is exactly the failure this
    guard exists to prevent.
    """
    target = Path(fmu_path).resolve()
    replacement = 'uri = "' + target.as_uri() + '"'
    found = [False]

    def swap(match):
        if Path(match.group(1).split('//', 1)[-1].lstrip('/')).name != target.name:
            return match.group(0)
        found[0] = True
        return replacement

    rewritten = URI.sub(swap, text)
    if not found[0]:
        raise ValueError(
            'The model has no metadata ToolExecution uri naming %s; '
            'its uri must point at the submitted FMU' % target.name
        )
    return rewritten


def parse_tool_bindings(text):
    """Return each FMI name's SysML role, feature name and optional default.

    SysML permits multiline feature declarations; match a role/type/default
    through its ToolVariable annotation instead of assuming it is one line.
    """
    header = re.compile(r'\b(?P<role>in|out|return)\s+(?P<feature>[A-Za-z_]\w*)\s*:')
    type_name = re.compile(r'\s*[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*(?:\s*\[[^\]]*\])?')
    bindings = {}
    for variable in TOOL_VARIABLE.finditer(text):
        # The nearest preceding unclosed feature header owns this annotation.
        prefix = text[:variable.start()]
        candidates = list(header.finditer(prefix))
        if not candidates:
            continue
        declaration = candidates[-1]
        tail = prefix[declaration.end():]
        type_match = type_name.match(tail)
        default = None
        if type_match:
            after_type = tail[type_match.end():]
            value_match = DECLARED_DEFAULT.search(after_type)
            if value_match:
                default = float(value_match.group('value'))
        bindings[variable.group('variable')] = {
            'role': declaration.group('role'),
            'feature': declaration.group('feature'),
            'default': default,
        }
    return bindings


def parse_tool_variables(text):
    """Feature defaults guarded by ``@ToolVariable``, keyed by FMU variable name."""
    return {name: info['default'] for name, info in parse_tool_bindings(text).items()
            if info['default'] is not None}


def parameter_values(text, description):
    """Numeric/Boolean FMI start values declared as @ToolVariable parameters."""
    variables = {variable.name: variable for variable in description.modelVariables}
    start_values = {}
    for name, binding in parse_tool_bindings(text).items():
        if binding['role'] != 'in' or name not in variables:
            continue
        variable = variables[name]
        if variable.causality != 'parameter' or binding['default'] is None:
            continue
        if variable.type in ('Real', 'Float32', 'Float64'):
            start_values[name] = binding['default']
        elif variable.type in ('Integer', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt8', 'UInt16', 'UInt32', 'UInt64'):
            start_values[name] = int(binding['default'])
    return start_values


def return_variable(text):
    """The FMU variable a calc returns, which an analysis' value should equal."""
    for name, binding in parse_tool_bindings(text).items():
        if binding['role'] == 'return':
            return name
    return None


def experiment_from_model(text):
    """The experiment the analysis will use, read from its ``fmi:*`` defaults."""
    variables = parse_tool_variables(text)
    return {
        field: variables[name]
        for name, field in EXPERIMENT_VARIABLES.items()
        if name in variables
    }


def apply_experiment(text, experiment):
    """Bind explicit experiment values to multiline or single-line FMI inputs."""
    by_variable = {
        field: value for field, value in experiment.items()
        if field in EXPERIMENT_VARIABLES.values()
    }
    reverse = {variable: field for variable, field in EXPERIMENT_VARIABLES.items()}
    header = re.compile(r'\b(?P<role>in|out|return)\s+(?P<feature>[A-Za-z_]\w*)\s*:')
    type_name = re.compile(r'\s*[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*(?:\s*\[[^\]]*\])?')
    edits = []
    seen = set()
    for variable in TOOL_VARIABLE.finditer(text):
        field = reverse.get(variable.group('variable'))
        if field not in by_variable or field in seen:
            continue
        candidates = list(header.finditer(text[:variable.start()]))
        if not candidates:
            raise ValueError('Cannot find SysML input declaration for FMI field ' + field)
        declaration = candidates[-1]
        tail_start = declaration.end()
        tail = text[tail_start:variable.start()]
        type_match = type_name.match(tail)
        if not type_match:
            raise ValueError('Cannot find SysML input type for FMI field ' + field)
        after_type_start = tail_start + type_match.end()
        after_type = text[after_type_start:variable.start()]
        default = DECLARED_DEFAULT.search(after_type)
        value = format(float(by_variable[field]), '.17g')
        if default:
            start = after_type_start + default.start('value')
            end = after_type_start + default.end('value')
            edits.append((start, end, value))
        else:
            insert = after_type_start + len(after_type.rstrip())
            edits.append((insert, insert, ' = ' + value))
        seen.add(field)
    missing = set(by_variable).difference(seen)
    if missing:
        raise ValueError('No @ToolVariable input binds FMI experiment field(s): ' + ', '.join(sorted(missing)))
    for start, end, value in sorted(edits, reverse=True):
        text = text[:start] + value + text[end:]
    return text


def experiment_from_fmu(description):
    defaults = getattr(description, 'defaultExperiment', None)
    if defaults is None:
        return {}
    experiment = {}
    for field in ('startTime', 'stopTime', 'stepSize', 'tolerance'):
        value = getattr(defaults, field, None)
        if value is not None:
            experiment[field] = float(value)
    return experiment


def resolve_experiment(supplied, model_defaults, fmu_defaults):
    """Explicit request wins, then the model's ``fmi:*`` defaults, then the FMU's."""
    experiment = {}
    for field in ('startTime', 'stopTime', 'stepSize', 'tolerance'):
        for source in (supplied or {}, model_defaults or {}, fmu_defaults or {}):
            if source.get(field) is not None:
                experiment[field] = float(source[field])
                break
    experiment.setdefault('startTime', 0.0)
    experiment.setdefault('stopTime', 1.0)
    if experiment['stopTime'] <= experiment['startTime']:
        raise ValueError('stopTime must be greater than startTime')
    return experiment


def trajectory_columns(description):
    """FMU variables worth plotting: states and outputs, not parameters or derivatives."""
    columns = []
    for variable in description.modelVariables:
        name = variable.name
        if name.startswith('der('):
            continue
        if variable.causality not in ('output', 'local'):
            continue
        if variable.variability in ('constant', 'parameter'):
            continue
        if variable.type != 'Real':
            continue
        if name in columns:
            continue
        columns.append(name)
        if len(columns) >= MAX_TRAJECTORY_COLUMNS:
            break
    return columns


def fmu_platform(path):
    """The ``binaries/<platform>`` directory the FMU ships, so receipts name the arch."""
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
    except zipfile.BadZipFile:
        raise ValueError('The submitted .fmu is not a readable FMU archive')
    platforms = sorted({
        name.split('/')[1]
        for name in names
        if name.startswith('binaries/') and name.count('/') >= 2
    })
    if len(platforms) > 1:
        return ','.join(platforms)
    return platforms[0] if platforms else 'unknown'


def write_trajectory(result, columns, target):
    """Write the FMPy structured array as CSV, ``time`` first."""
    with open(target, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['time'] + columns)
        for index, row in enumerate(result):
            if index >= MAX_TRAJECTORY_ROWS:
                break
            writer.writerow(
                [repr(float(row['time']))]
                + [repr(float(row[name])) for name in columns]
            )
    return min(len(result), MAX_TRAJECTORY_ROWS)


def _scalar(value):
    """The number an analysis output carries, or None when it is not one number."""
    if isinstance(value, (list, tuple)):
        value = value[0] if len(value) == 1 else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def compare_outputs(outputs, last_row, columns, return_column=None):
    """Where the analysis' returned value and the trajectory's last sample differ.

    The analysis names its own feature (``return result : Real = Decay();``)
    while the trajectory is keyed by the calc's FMU variable. The comparison
    therefore pairs the calc's ``return`` ToolVariable with the analysis' single
    returned value, and says so in its record rather than guessing a name match.
    """
    if return_column is None or return_column not in columns:
        return []
    candidates = [
        (feature, _scalar(value))
        for feature, value in (outputs or {}).items()
        if _scalar(value) is not None
    ]
    if len(candidates) != 1:
        return []
    feature, value = candidates[0]
    observed = float(last_row[return_column])
    difference = abs(observed - value)
    return [{
        'analysisFeature': feature,
        'trajectoryColumn': return_column,
        'analysis': value,
        'trajectory': observed,
        'absoluteDifference': difference,
        'matches': difference <= max(1e-9, 1e-9 * abs(observed)),
    }]


def verdict_checks(verdicts):
    """Map OpenSysML verdicts onto the worker's ``verification.checks`` shape."""
    checks = []
    for index, verdict in enumerate(verdicts or []):
        error = getattr(verdict, 'error', None)
        element = getattr(verdict, 'element', None) or getattr(verdict, 'element_id', '')
        checks.append({
            'id': str(element or ('verdict-%d' % index))[:150],
            'passed': None if error else bool(getattr(verdict, 'holds', False)),
            'kind': getattr(verdict, 'kind', None),
            'detail': error or getattr(verdict, 'condition', None) or None,
        })
    return checks


def _version_of(module):
    return str(getattr(module, '__version__', '') or '')


def run(request, work=None):
    """Execute one SysML FMI job and return the worker's reply object.

    Standard output is redirected to standard error for the whole body: FMPy
    prints a logger-proxy warning on import when its bundled ``logging.so`` does
    not match the platform, and this function's caller writes the single JSON
    reply on stdout.
    """
    with contextlib.redirect_stdout(sys.stderr):
        return _run(request, work)


def _run(request, work):
    root = Path(work or WORK)
    operation = request.get('operation') or 'simulate'
    if operation != 'simulate':
        raise ValueError('sysml-fmi only executes simulate jobs')
    model_name = request.get('modelName')
    # SysML qualified names separate packages with ``::``; accept a dotted
    # spelling too, since callers may pass a Modelica-style identifier.
    if not isinstance(model_name, str) or not re.fullmatch(
        r'[A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*', model_name
    ):
        raise ValueError('modelName must be the qualified name of an analysis or calc')

    source_files = request.get('sourceFiles') or []
    fmu_files = request.get('fmuFiles') or []
    if len(source_files) != 1:
        raise ValueError('A SysML FMI job takes exactly one .sysml source')
    if len(fmu_files) != 1:
        raise ValueError('A SysML FMI job takes exactly one .fmu')
    if not source_files[0]['path'].endswith('.sysml'):
        raise ValueError('The model source must be a .sysml file')
    if not fmu_files[0]['path'].endswith('.fmu'):
        raise ValueError('The pinned binary must be a .fmu file')

    materialize(source_files, root)
    materialize(fmu_files, root, limit=MAX_FMU_BYTES)

    model_path = (root / source_files[0]['path']).resolve()
    fmu_path = (root / fmu_files[0]['path']).resolve()
    original = model_path.read_text(encoding='utf-8')
    uri_rewritten = rewrite_uri(original, fmu_path)

    home = tool_home()
    binary = home / 'bin' / 'sysml-grpc'
    runner = home / 'bin' / 'opensysml-fmi-runner'
    python = home / 'venv' / 'bin' / 'python'
    if not binary.is_file():
        binary = Path('/usr/local/bin/sysml-grpc')
    if not runner.is_file():
        runner = Path('/usr/local/bin/opensysml-fmi-runner')
    if binary.is_file():
        os.environ['OPENSYSML_BINARY'] = str(binary)
    if runner.is_file():
        os.environ['OPENSYSML_FMI_RUNNER'] = str(runner)
    if python.is_file():
        site = str(home / 'venv' / 'lib' / ('python%s.%s' % sys.version_info[:2]) / 'site-packages')
        os.environ['PYTHONPATH'] = site + (os.pathsep + os.environ['PYTHONPATH'] if os.environ.get('PYTHONPATH') else '')

    import opensysml
    import fmpy

    diagnostics = []
    try:
        connection = opensysml.connect(auto_start=True, version=OPENSYSML_VERSION)
        try:
            model = connection.load_from_content(uri_rewritten, strict=True)
            if model.errors:
                raise ValueError('OpenSysML rejected the model: ' + str(model.diagnostics))
            description = fmpy.read_model_description(str(fmu_path))
            experiment = resolve_experiment(
                request.get('simulation') or {},
                experiment_from_model(uri_rewritten),
                experiment_from_fmu(description),
            )
            # The OpenSysML calculation must see the same inputs as FMPy; the
            # model source in the evidence snapshot retains its original defaults.
            executable_model = apply_experiment(uri_rewritten, request.get('simulation') or {})
            # Reload the same text with the shared connection after binding the
            # explicit experiment values to the FMI calc's default inputs.
            model = connection.load_from_content(executable_model, strict=True)
            if model.errors:
                raise ValueError('OpenSysML rejected the FMI experiment bindings: ' + str(model.diagnostics))
            try:
                analysis = model.run_analysis(model_name)
                result_kind = 'analysis'
            except opensysml.WrongKindError:
                # The name is a calc def, not an analysis case: evaluate it directly.
                # Any other failure is a real one and must not be retried as a calc.
                analysis = None
                result_kind = 'calc'
                calc = model.calc(model_name)

            columns = trajectory_columns(description)
            if not columns:
                raise ValueError('The FMU exposes no plottable Real state or output variables')
            simulate_kwargs = {
                'validate': False,
                'start_time': experiment['startTime'],
                'stop_time': experiment['stopTime'],
                'output': columns,
            }
            if experiment.get('stepSize'):
                simulate_kwargs['step_size'] = experiment['stepSize']
            if experiment.get('tolerance'):
                simulate_kwargs['relative_tolerance'] = experiment['tolerance']
            simulate_kwargs['start_values'] = parameter_values(uri_rewritten, description)
            trajectory = fmpy.simulate_fmu(str(fmu_path), **simulate_kwargs)
            if len(trajectory) == 0:
                raise ValueError('FMPy produced no trajectory samples')

            trajectory_csv = root / 'trajectory.csv'
            rows = write_trajectory(trajectory, columns, trajectory_csv)

            outputs = analysis.outputs if analysis is not None else {model_name.rsplit('::', 1)[-1]: calc.value}
            verdicts = list(analysis.verdicts) if analysis is not None else []
            checks = verdict_checks(verdicts)
            comparisons = compare_outputs(outputs, trajectory[-1], columns, return_variable(uri_rewritten))
            agreed = all(item['matches'] for item in comparisons) if comparisons else None
            if agreed is False:
                checks.append({
                    'id': 'trajectory-consistency',
                    'passed': False,
                    'kind': 'execution-consistency',
                    'detail': 'OpenSysML analysis return differs from the final FMPy trajectory sample',
                })

            (root / 'verdicts.json').write_text(json.dumps({
                'resultKind': result_kind,
                'analysis': model_name,
                'outputs': {key: _plain(value) for key, value in (outputs or {}).items()},
                'verdicts': [
                    {
                        'kind': getattr(verdict, 'kind', None),
                        'element': getattr(verdict, 'element', None),
                        'holds': bool(getattr(verdict, 'holds', False)),
                        'condition': getattr(verdict, 'condition', None),
                        'error': getattr(verdict, 'error', None),
                    }
                    for verdict in verdicts
                ],
                'trajectoryComparison': comparisons,
            }, indent=2, ensure_ascii=False), encoding='utf-8')

            receipt = {
                'schema': 'manta-sysml-fmi-execution-v1',
                'jobId': request.get('jobId'),
                'inputHash': request.get('inputHash'),
                'operation': operation,
                'analysis': {'fqn': model_name, 'kind': result_kind},
                'model': {'path': source_files[0]['path'], 'sha256': source_files[0]['sha256']},
                'sourceHashes': [
                    {'path': item['path'], 'sha256': item['sha256']}
                    for item in source_files
                ],
                'fmu': {
                    'path': fmu_files[0]['path'],
                    'sha256': fmu_files[0]['sha256'],
                    'platform': fmu_platform(fmu_path),
                },
                'experiment': experiment,
                'parameters': parameter_values(uri_rewritten, description),
                'trajectory': {'path': 'trajectory.csv', 'columns': columns, 'rows': rows},
                'tools': {
                    'opensysml': {'id': 'sysml-grpc', 'version': OPENSYSML_VERSION,
                                  'client': _version_of(opensysml)},
                    'fmpy': {'id': 'fmpy', 'version': _version_of(fmpy)},
                },
                'trajectoryMatchesVerdict': agreed,
                'isolation': getattr(sys.modules.get('worker'), 'ISOLATION',
                                     'shared application container; same user and filesystem access'),
            }
            (root / 'execution-receipt.json').write_text(
                json.dumps(receipt, indent=2, ensure_ascii=False), encoding='utf-8'
            )

            failed = [check for check in checks if check['passed'] is False]
            success = not failed
            if failed:
                diagnostics.append(
                    'Analysis assertions not satisfied: ' + ', '.join(check['id'] for check in failed)
                )
            if agreed is False:
                diagnostics.append(
                    'The analysis verdict and the plotted trajectory disagree; '
                    'see verdicts.json trajectoryComparison'
                )

            wanted = ['trajectory.csv', 'verdicts.json', 'execution-receipt.json']
            exported = []
            for name in wanted:
                target = root / name
                if not target.is_file():
                    continue
                payload = target.read_bytes()
                exported.append({
                    'path': name,
                    'sha256': sha(payload),
                    'contentBase64': base64.b64encode(payload).decode(),
                    'mimeType': 'text/csv' if name.endswith('.csv') else 'application/json',
                })

            return {
                'exitCode': 0,
                'success': success,
                'tool': {
                    'id': TOOL_ID,
                    'version': '%s/opensysml-%s/fmpy-%s' % (
                        OPENSYSML_VERSION, _version_of(opensysml), _version_of(fmpy)
                    ),
                },
                'diagnostics': '\n'.join(str(item) for item in diagnostics),
                'receipt': receipt,
                'files': exported,
                'outputKind': 'data',
                'verification': {'checks': checks},
            }
        finally:
            connection.close()
    except Exception:
        # Never leave executable model text in the archived input snapshot.
        model_path.write_text(original, encoding='utf-8')
        raise
    finally:
        # Successful jobs also retain only the exact submitted source. The
        # rewritten copy is an execution detail, not a changed model revision.
        model_path.write_text(original, encoding='utf-8')


def _plain(value):
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if hasattr(value, 'item'):
        return value.item()
    return value


def execute_child(request, process_runner, timeout=600):
    """Run the native FMI stack in a bounded worker subprocess.

    The caller provides the task worker's ``run`` function, which applies the
    normal CPU/file-size limits and cancellation handling to this child.
    """
    python = tool_home() / 'venv' / 'bin' / 'python'
    if not python.is_file():
        raise RuntimeError('OpenSysML FMI Python environment is not installed')
    payload=dict(request)
    workdir=payload.pop('_workdir',None)
    env=dict(os.environ)
    if workdir:
        env['SYML_FMI_WORK']=workdir
    if python.is_file():
        site=python.parent.parent/'lib'/('python%s.%s' % sys.version_info[:2])/'site-packages'
        if site.is_dir():
            env['PYTHONPATH']=str(site)+(os.pathsep+env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
    process = process_runner(
        [str(python), str(Path(__file__).resolve()), '--child'],
        timeout,
        json.dumps(payload).encode('utf-8'),
        env=env,
    )
    if process['code'] != 0:
        try:
            return json.loads(process['stdout'])
        except (ValueError, TypeError):
            raise RuntimeError(process['stderr'] or 'SysML FMI child failed')
    try:
        response = json.loads(process['stdout'])
    except (ValueError, TypeError) as error:
        raise RuntimeError('SysML FMI child returned invalid JSON: %s' % error)
    if not isinstance(response, dict):
        raise RuntimeError('SysML FMI child response must be a JSON object')
    return response


def _failure(request, error):
    request = request if isinstance(request, dict) else {}
    return {
        'exitCode': 1,
        'success': False,
        'tool': {'id': TOOL_ID, 'version': OPENSYSML_VERSION},
        'diagnostics': str(error),
        'receipt': {
            'inputHash': request.get('inputHash'),
            'sourceHashes': [
                {'path': item.get('path'), 'sha256': item.get('sha256')}
                for item in request.get('sourceFiles', []) if isinstance(item, dict)
            ],
            'fmu': ({'path': request['fmuFiles'][0].get('path'),
                     'sha256': request['fmuFiles'][0].get('sha256')}
                    if request.get('fmuFiles') and isinstance(request['fmuFiles'][0], dict)
                    else None),
        },
        'files': [],
        'verification': {'checks': []},
    }


def main(child=False):
    """One JSON request and reply for standalone checks or task-worker child mode."""
    try:
        request = json.load(sys.stdin)
        reply = run(request, work=Path(os.environ.get('SYML_FMI_WORK') or WORK))
        if child and reply.get('exitCode') == 0:
            for item in reply.get('files', []):
                name = item.get('path')
                if name in ('trajectory.csv', 'verdicts.json', 'execution-receipt.json'):
                    target = Path(os.environ.get('SYML_FMI_WORK') or WORK) / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(base64.b64decode(item['contentBase64'], validate=True))
            reply = {key: reply[key] for key in ('exitCode','success','tool','diagnostics','receipt','verification','outputKind')}
    except Exception as error:  # noqa: BLE001 - protocol replies, not tracebacks
        reply = _failure(locals().get('request'), error)
    print(json.dumps(reply))
    return 0 if reply['exitCode'] == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main(child=len(sys.argv) > 1 and sys.argv[1] == '--child'))
