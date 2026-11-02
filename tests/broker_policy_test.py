"""Policy tests need only Python; actual container acceptance is separate."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('broker', Path(__file__).resolve().parents[1]/'deploy/runner/broker.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class Policy(unittest.TestCase):
    def test_docker_controls_cannot_be_requested(self):
        for field, value in [('image','evil'), ('mount','/'), ('network','host'), ('env',{'API_KEY':'x'}), ('privileged',True)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                broker.validate({'kind':'command','project':'project-one','command':'true',field:value})

    def test_project_escape_and_root_are_rejected(self):
        for project in ['', '/', '../project-one', 'project-one/../../', 'project-one,src=/etc', 'project-one/sub']:
            with self.subTest(project=project), self.assertRaises(ValueError):
                broker.validate({'kind':'command','project':project,'command':'true'})

    def test_nos3_default_deadline_is_bounded_and_accepted(self):
        request = {'kind':'adapter','adapter':'flight','mode':'nos3','input':'{}','timeoutMs':1800000}
        self.assertEqual(broker.validate(request)['timeoutMs'], 1800000)
        for adapter, timeout in [('flight',1800001), ('gis',960001)]:
            with self.subTest(adapter=adapter), self.assertRaises(ValueError):
                broker.validate({**request, 'adapter':adapter, 'timeoutMs':timeout})

    def test_unbounded_tasks_are_rejected(self):
        for timeout in [True, 0, -1, float('nan'), float('inf'), 60001]:
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                broker.validate({'kind':'command','project':'project-one','command':'true','timeoutMs':timeout})


if __name__ == '__main__':
    unittest.main()
