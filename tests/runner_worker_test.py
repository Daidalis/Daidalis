import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'worker', Path(__file__).resolve().parents[1] / 'deploy/runner/worker.py'
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class OpenScadPreviewTests(unittest.TestCase):
    def test_source_camera_cannot_disable_preview_framing(self):
        source = '$vpr=[62,0,28]; cube([4600,1820,700],center=true);'
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def execute(argv, timeout, stdin=None):
                calls.append(argv)
                if argv[0] == 'openscad':
                    (root / 'daidalis_geometry.stl').write_text(
                        'solid fixture\nfacet normal 0 0 1\nouter loop\n'
                        'vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\n'
                        'endloop\nendfacet\nendsolid fixture\n'
                    )
                else:
                    (root / 'daidalis_preview.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture')
                return {'code': 0, 'stdout': '', 'stderr': ''}

            with patch.object(worker, 'WORK', root), patch.object(
                worker, 'version', return_value={'ready': True, 'version': 'fixture'}
            ), patch.object(worker, 'run', side_effect=execute):
                result = worker.professional({
                    'toolId': 'openscad', 'operation': 'simulate',
                    'mainFile': 'car.scad', 'inputHash': 'a' * 64,
                    'sourceFiles': [{
                        'path': 'car.scad', 'content': source,
                        'sha256': hashlib.sha256(source.encode()).hexdigest(),
                    }],
                })
            self.assertTrue(result['success'])
            self.assertEqual((root / 'car.scad').read_text(), source)
            preview = calls[1]
            self.assertTrue(any(argument.startswith('--camera=') for argument in preview))
            self.assertIn('--viewall', preview)
            self.assertIn('--autocenter', preview)


if __name__ == '__main__':
    unittest.main()
