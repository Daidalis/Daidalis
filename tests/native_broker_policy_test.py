"""Native execution accepts bounded continuation settings, not Docker controls."""
import importlib.util
from pathlib import Path
import sys
import unittest

RUNNER = Path(__file__).resolve().parents[1] / 'deploy/runner'
sys.path.insert(0, str(RUNNER))
try:
    spec = importlib.util.spec_from_file_location('native_broker', RUNNER / 'native-broker.py')
    native_broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native_broker)
finally:
    sys.path.pop(0)


class NativeBudgetPolicy(unittest.TestCase):
    def options(self, **updates):
        return {'baseUrl': 'http://127.0.0.1:18765/v1', 'apiKey': 'a' * 64, **updates}

    def test_bounded_continuation_is_accepted(self):
        for value in [0, 1, 3]:
            native_broker.validate_native_options(self.options(maxTurns=64, maxContinuations=value))
        native_broker.validate_native_options(self.options(maxTurns=64))

    def test_invalid_continuation_is_rejected(self):
        for value in [True, -1, 4, 1.5, '1', None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                native_broker.validate_native_options(self.options(maxContinuations=value))

    def test_docker_controls_and_unscoped_credentials_stay_rejected(self):
        for field, value in [('image', 'evil'), ('mount', '/'), ('network', 'host'), ('env', {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                native_broker.validate_native_options(self.options(**{field: value}))
        for update in [{'apiKey': 'unscoped'}, {'baseUrl': 'http://outside.invalid/v1'}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                native_broker.validate_native_options(self.options(**update))


if __name__ == '__main__':
    unittest.main()
