"""Standalone tests for sysml_fmi.run against the real local validation FMU.

The real FMU and tool binaries are only present in the development workspace.
All other tests in this module remain portable to the Docker CI image.
"""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'sysml_fmi', Path(__file__).resolve().parents[1] / 'deploy/runner/sysml_fmi.py'
)
sysml_fmi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sysml_fmi)

ROOT = Path(__file__).resolve().parents[1]
SIM = ROOT.parent / 'simulation'
PYTHON = SIM / 'env' / 'python' / 'bin' / 'python'
FMU = SIM / 'artifacts' / 'SimpleDecay.fmu'
MODEL = SIM / 'models' / 'FMUDecay.sysml'


def digest(data):
    return hashlib.sha256(data).hexdigest()


class PureRunnerTests(unittest.TestCase):
    def test_multiline_tool_variable_bindings(self):
        source='''calc def C {\n  in stopTime :\n    Real = 1.0 {\n      @ToolVariable { name = "fmi:stopTime"; }\n    }\n  return x : Real[1] { @ToolVariable { name = "x"; } }\n}\n'''
        self.assertEqual(sysml_fmi.experiment_from_model(source), {'stopTime': 1.0})
        overridden=sysml_fmi.apply_experiment(source, {'stopTime': 0.5})
        self.assertIn('Real = 0.5', overridden)
        self.assertEqual(sysml_fmi.return_variable(source), 'x')
        multiline_return = source.replace('return x : Real[1] { @ToolVariable', 'return x : Real[1] {\n    @ToolVariable')
        self.assertEqual(sysml_fmi.return_variable(multiline_return), 'x')


@unittest.skipUnless(PYTHON.is_file() and FMU.is_file() and MODEL.is_file(),
                     'local simulation/env assets are not available')
class RealFmiRun(unittest.TestCase):
    def setUp(self):
        self.model = MODEL.read_bytes()
        self.fmu = FMU.read_bytes()
        self.work = Path(tempfile.mkdtemp(prefix='manta-sysml-fmi-'))
        tool_home = self.work / 'opensysml'
        (tool_home / 'bin').mkdir(parents=True)
        (tool_home / 'bin' / 'sysml-grpc').symlink_to(
            SIM / 'env' / 'opensysml' / 'bin' / 'sysml-grpc'
        )
        (tool_home / 'bin' / 'opensysml-fmi-runner').symlink_to(
            SIM / 'scripts' / 'opensysml-fmi-runner'
        )
        self.previous_home = os.environ.get('SYML_FMI_HOME')
        os.environ['SYML_FMI_HOME'] = str(tool_home)
        self.request = {
            'jobId': 'professional_fixture',
            'inputHash': 'a' * 64,
            'operation': 'simulate',
            'modelName': 'FMUDecay::CheckDecay',
            'sourceFiles': [{
                'path': 'models/FMUDecay.sysml',
                'sha256': digest(self.model),
                'contentBase64': base64.b64encode(self.model).decode(),
            }],
            'fmuFiles': [{
                'path': 'models/SimpleDecay.fmu',
                'sha256': digest(self.fmu),
                'contentBase64': base64.b64encode(self.fmu).decode(),
            }],
        }

    def tearDown(self):
        if self.previous_home is None:
            os.environ.pop('SYML_FMI_HOME', None)
        else:
            os.environ['SYML_FMI_HOME'] = self.previous_home
        shutil.rmtree(self.work, ignore_errors=True)

    def test_analysis_verdict_and_fmpy_trajectory_share_the_same_final_value(self):
        result = sysml_fmi.run(self.request, work=self.work)
        self.assertTrue(result['success'])
        self.assertEqual(result['verification']['checks'][0]['passed'], True)
        self.assertEqual(result['receipt']['experiment']['stopTime'], 1.0)
        self.assertTrue(result['receipt']['trajectoryMatchesVerdict'])
        self.assertEqual(result['receipt']['sourceHashes'], [
            {'path': 'models/FMUDecay.sysml', 'sha256': digest(self.model)}
        ])
        self.assertEqual(result['receipt']['trajectory']['rows'], 501)
        self.assertEqual(result['receipt']['trajectory']['columns'], ['x'])
        self.assertEqual(result['receipt']['fmu']['platform'], 'linux64')
        trajectory = (self.work / 'trajectory.csv').read_text(encoding='utf-8').splitlines()
        self.assertEqual(trajectory[0], 'time,x')
        self.assertAlmostEqual(float(trajectory[-1].split(',')[1]), 0.36751125485715913, places=12)
        self.assertEqual((self.work / 'models/FMUDecay.sysml').read_bytes(), self.model)
        self.assertEqual([item['path'] for item in result['files']],
                         ['trajectory.csv', 'verdicts.json', 'execution-receipt.json'])

    def test_explicit_experiment_override_is_applied_to_both_engines(self):
        request = dict(self.request)
        request['simulation'] = {'stopTime': 0.5}
        source = dict(self.request['sourceFiles'][0])
        model = self.model.decode().replace('result > 0.30 and result < 0.45', 'result > 0.5 and result < 0.7').encode()
        source['contentBase64'] = base64.b64encode(model).decode()
        source['sha256'] = digest(model)
        request['sourceFiles'] = [source]
        result = sysml_fmi.run(request, work=self.work)
        self.assertEqual(result['receipt']['experiment']['stopTime'], 0.5)
        self.assertTrue(result['success'])
        self.assertEqual(result['receipt']['trajectory']['rows'], 251)
        self.assertTrue(result['receipt']['trajectoryMatchesVerdict'])

    def test_missing_fmu_uri_is_refused(self):
        request = dict(self.request)
        source = dict(self.request['sourceFiles'][0])
        model = self.model.decode().replace('SimpleDecay.fmu', 'Different.fmu').encode()
        source['contentBase64'] = base64.b64encode(model).decode()
        source['sha256'] = digest(model)
        request['sourceFiles'] = [source]
        with self.assertRaisesRegex(ValueError, 'no metadata ToolExecution uri'):
            sysml_fmi.run(request, work=self.work)


if __name__ == '__main__':
    unittest.main()
