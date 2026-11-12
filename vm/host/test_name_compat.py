#!/usr/bin/env python3
"""Fixture-only name migration checks; no VM, real volumes, or model calls."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from name_compat import CURRENT, LEGACY, profile, save_profile, ssh_command


VM = Path(__file__).resolve().parents[1]


class NameProfileTests(unittest.TestCase):
    def test_new_state_uses_current_names(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(profile(directory), CURRENT)
            self.assertFalse((Path(directory) / 'name-profile.json').exists())

    def test_existing_disk_keeps_identity_after_new_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / 'native-ready.json').write_text(json.dumps({'schema': 'manta-nos3-native-ready-v1'}))
            self.assertEqual(profile(state), LEGACY)
            save_profile(state, profile(state))
            (state / 'native-ready.json').write_text(json.dumps({'schema': 'daidalis-nos3-native-ready-v1'}))
            self.assertEqual(profile(state), LEGACY)
            self.assertEqual((state / 'name-profile.json').stat().st_mode & 0o777, 0o600)

    def test_existing_cloud_seed_selects_old_account(self):
        with tempfile.TemporaryDirectory() as directory:
            seed = Path(directory) / 'seed'
            seed.mkdir()
            (seed / 'user-data').write_text('users:\n  - name: manta\n')
            self.assertEqual(profile(directory), LEGACY)

    def test_arbitrary_or_symlink_profile_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'name-profile.json'
            file.write_text(json.dumps({**CURRENT, 'root': '/somewhere-else'}))
            with self.assertRaises(ValueError):
                profile(directory)
            file.unlink()
            source = Path(directory) / 'elsewhere.json'
            source.write_text(json.dumps(LEGACY))
            file.symlink_to(source)
            with self.assertRaises(ValueError):
                profile(directory)

    def test_ssh_supplies_only_closed_paths_and_preserves_user_text(self):
        command = "python3 -c 'import os,json;print(json.dumps({k:v for k,v in os.environ.items() if k.startswith(\"DAIDALIS_VM_\")}))'"
        completed = subprocess.run(['/bin/sh', '-c', ssh_command(command, LEGACY)],
                                   env={'PATH': os.environ['PATH']}, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(completed.stdout), {
            'DAIDALIS_VM_ROOT': '/srv/manta', 'DAIDALIS_VM_TRANSFER': '/mnt/manta-transfer',
            'DAIDALIS_VM_HOME': '/home/manta', 'DAIDALIS_VM_USER': 'manta',
        })
        with self.assertRaises(ValueError):
            ssh_command('true', {**LEGACY, 'user': 'root'})

    def test_worker_paths_resolve_without_source_mutation(self):
        checked = 0
        for directory in ('worker', 'nos3-plan', 'verification'):
            for file in (VM / directory).rglob('*.py'):
                source = file.read_bytes()
                tree = ast.parse(source)
                helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_vm_name_path']
                if not helpers:
                    continue
                scope = {}
                exec(compile(ast.Module(body=helpers, type_ignores=[]), str(file), 'exec'), scope)
                value = '/srv/daidalis/test /mnt/daidalis-transfer/file /home/daidalis/.ssh /work/MantaParts.sysml'
                with patch.dict(os.environ, {}, clear=True):
                    self.assertEqual(scope['_vm_name_path'](value), value)
                with patch.dict(os.environ, {"DAIDALIS_VM_" + key.upper(): LEGACY[key] for key in ('root', 'transfer', 'home')}, clear=True):
                    self.assertEqual(scope['_vm_name_path'](value), '/srv/manta/test /mnt/manta-transfer/file /home/manta/.ssh /work/MantaParts.sysml')
                self.assertEqual(file.read_bytes(), source)
                checked += 1
        self.assertGreaterEqual(checked, 15)

    def test_worker_schema_aliases_do_not_accept_arbitrary_prefixes(self):
        checked = 0
        for file in (VM / 'worker').glob('*.py'):
            functions = [node for node in ast.parse(file.read_bytes()).body if isinstance(node, ast.FunctionDef) and node.name == '_product_schema_matches']
            if not functions:
                continue
            scope = {}
            exec(compile(ast.Module(body=functions, type_ignores=[]), str(file), 'exec'), scope)
            matches = scope['_product_schema_matches']
            self.assertTrue(matches('manta-example-v1', 'daidalis-example-v1'))
            self.assertTrue(matches('daidalis-example-v1', 'daidalis-example-v1'))
            self.assertFalse(matches('other-example-v1', 'daidalis-example-v1'))
            self.assertFalse(matches(None, 'daidalis-example-v1'))
            checked += 1
        self.assertEqual(checked, 8)

    def test_renamed_recipe_preserves_an_edited_native_build(self):
        file = VM / 'worker/native-readiness.py'
        definitions = [node for node in ast.parse(file.read_bytes()).body
                       if isinstance(node, (ast.FunctionDef, ast.ClassDef))
                       and node.name in ('check', 'RuntimeChanged', '_product_schema_matches')]
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            original = json.dumps({'schema': 'manta-nos3-native-ready-v1', 'inputHash': 'old-recipe',
                                   'binaries': [{'sha256': 'original-binary'}]})
            receipt.write_text(original)
            scope = {'RECEIPT': receipt, 'json': json,
                     'inputs': lambda: ('new-recipe', {}),
                     'binaries': lambda: [{'sha256': 'edited-binary'}],
                     'private_assets': lambda: self.fail('Edited builds must stop before rechecking/replacing assets')}
            exec(compile(ast.Module(body=definitions, type_ignores=[]), str(file), 'exec'), scope)
            with self.assertRaises(scope['RuntimeChanged']):
                scope['check']()
            self.assertEqual(receipt.read_text(), original)


if __name__ == '__main__':
    unittest.main()
