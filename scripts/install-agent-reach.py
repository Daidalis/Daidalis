#!/usr/bin/env python3
"""Install the pinned upstream Agent Reach in a project-owned virtual environment."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import Request, urlopen
import venv

VERSION = '1.6.1'
REVISION = 'c70ae6da5d39bc90e09ad2ae0575ccc89f31e284'
URL = f'https://codeload.github.com/Panniantong/agent-reach/zip/{REVISION}'
SHA256 = '291d7de701e7596055cad979064986000101613d4de4ea128cc653ad14164e81'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path(__file__).resolve().parents[1]/'.local/agent-reach')
    parser.add_argument('--archive', type=Path, help='Use a downloaded archive; the same pinned checksum is required')
    args = parser.parse_args()
    prefix = args.prefix.resolve()
    if prefix in {Path('/'), Path.home(), Path(sys.prefix), Path(sys.base_prefix)}:
        parser.error('Use a dedicated application virtual environment as --prefix')
    prefix.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='agent-reach-install-', dir=prefix.parent) as directory:
        archive = Path(directory)/'agent-reach.zip'
        if args.archive:
            shutil.copyfile(args.archive, archive)
        else:
            with urlopen(Request(URL, headers={'User-Agent':'Daidalis-Agent-Reach-Installer'}), timeout=90) as response:
                data = response.read(20*1024*1024+1)
            if len(data)>20*1024*1024:
                raise RuntimeError('Agent Reach source archive exceeds 20 MB')
            archive.write_bytes(data)
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA256:
            raise RuntimeError('Agent Reach source checksum mismatch; nothing was installed')
        python = prefix/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        uv = shutil.which('uv')
        if uv:
            install_env = {**os.environ,'UV_CACHE_DIR':str(prefix.parent/'agent-reach-cache'),'UV_PYTHON_DOWNLOADS':'never'}
            subprocess.run([uv,'venv','--allow-existing','--python',sys.executable,str(prefix)],env=install_env,check=True)
            subprocess.run([uv,'pip','install','--python',str(python),str(archive)],env=install_env,check=True)
        else:
            venv.EnvBuilder(with_pip=True).create(prefix)
            subprocess.run([str(python),'-m','pip','install','--disable-pip-version-check','--no-cache-dir',str(archive)],check=True)
        manifest = {'version':VERSION,'revision':REVISION,'url':URL,'sha256':SHA256}
        (prefix/'daidalis-source.json').write_text(json.dumps(manifest,indent=2)+'\n')
        print(json.dumps({'installed':True,**manifest,'executable':str(prefix/('Scripts/agent-reach.exe' if os.name=='nt' else 'bin/agent-reach'))}))


if __name__=='__main__':
    main()
