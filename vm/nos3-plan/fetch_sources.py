#!/usr/bin/env python3
"""Fetch pinned public NASA sources into the isolated VM staging directory.

No git global config, host packages, or original project files are modified.
"""
import argparse
import hashlib
import io
import json
import pathlib
import shutil
import subprocess
import tarfile
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--nos3-checkout', type=pathlib.Path, required=True, help='Explicit public NASA NOS3 checkout at the pinned commit; never modified')
parser.add_argument('--vm-root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
options = parser.parse_args()
BASE = options.vm_root.resolve()
ORIGINAL = options.nos3_checkout.resolve()
DEST = BASE / 'source' / 'nos3'
ALLOW = {
    'fsw/cfe', 'fsw/osal', 'fsw/psp', 'fsw/tools/elf2cfetbl',
    'fsw/apps/hwlib', 'fsw/apps/io_lib', 'fsw/apps/ci_lab', 'fsw/apps/to_lab', 'fsw/apps/sch',
    'sims/sim_common', 'sims/nos_time_driver', 'sims/sim_terminal', 'sims/truth_42_sim',
    'components/generic_adcs', 'components/generic_star_tracker',
    'components/generic_css', 'components/generic_fss', 'components/generic_mag',
    'components/generic_imu', 'components/generic_reaction_wheel', 'components/generic_torquer',
    'components/novatel_oem615',
}
MANIFEST = []

def archive(repo, revision, dest):
    dest.mkdir(parents=True, exist_ok=True)
    stamp = dest / '.manta-source.json'
    if stamp.exists():
        return json.loads(stamp.read_text())
    url = f'https://codeload.github.com/{repo}/tar.gz/{revision}'
    print('Fetching', repo, revision, flush=True)
    data = urllib.request.urlopen(url, timeout=120).read()
    entry = {'repo': repo, 'revision': revision, 'url': url,
             'archiveSha256': hashlib.sha256(data).hexdigest(), 'archiveBytes': len(data)}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
        prefix = tf.getmembers()[0].name.split('/')[0] + '/'
        for m in tf.getmembers():
            name = m.name.removeprefix(prefix)
            if not name or m.name == prefix.rstrip('/'):
                continue
            p = pathlib.PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts:
                raise RuntimeError('Unsafe archive path')
            target = dest / str(p)
            if m.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif m.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tf.extractfile(m) as src, target.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
                target.chmod(m.mode & 0o777)
            elif m.issym():
                # NASA source symlinks are retained only when they stay inside this subtree.
                link = pathlib.PurePosixPath(m.linkname)
                if link.is_absolute() or '..' in link.parts:
                    raise RuntimeError('Unsafe source symlink')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(m.linkname)
    stamp.write_text(json.dumps(entry, indent=2) + '\n')
    return entry

rev = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ORIGINAL, text=True).strip()
if rev != '5a3bdee6be9a2c67fdf994ae6db56d5c60395302':
    raise SystemExit('NOS3 checkout must be at pinned commit 5a3bdee6be9a2c67fdf994ae6db56d5c60395302')
MANIFEST.append(archive('nasa/nos3', rev, DEST))
modules = {}
path = None
for line in (ORIGINAL / '.gitmodules').read_text().splitlines():
    if line.strip().startswith('path ='):
        path = line.split('=', 1)[1].strip()
    elif line.strip().startswith('url ='):
        modules[path] = line.split('=', 1)[1].strip().removeprefix('https://github.com/').removesuffix('.git')
for path in sorted(ALLOW):
    tree = subprocess.check_output(['git', 'ls-tree', 'HEAD', path], cwd=ORIGINAL, text=True)
    sha = tree.split()[2]
    MANIFEST.append(dict(path=path, **archive(modules[path], sha, DEST / path)))
MANIFEST.append(dict(path='42', **archive('nasa-itc/42', 'dev_20260403', BASE / 'source' / '42')))
(BASE / 'source' / 'manifest.json').write_text(json.dumps(MANIFEST, indent=2) + '\n')
print('Fetched', len(MANIFEST), 'pinned source archives', flush=True)
