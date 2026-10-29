"""Fetch slow official packages concurrently, checking hashes from signed APT indexes."""
import os
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit, unquote

packages=['omc='+os.environ['MODELICA_VERSION'],'omlibrary']
if os.environ.get('MODELICA_GUI')=='1':packages.append('omedit='+os.environ['MODELICA_VERSION'])
plan=subprocess.check_output(['apt-get','--print-uris','--yes','--no-install-recommends','install',
                             *packages],text=True)
entries=[]
for line in plan.splitlines():
    match=re.fullmatch(r"'([^']+)' ([^ ]+) ([0-9]+) .+",line)
    if not match:continue
    url,filename,size=match.groups()
    if urlsplit(url).hostname!='build.openmodelica.org':continue
    if urlsplit(url).scheme!='https' or not re.fullmatch(r'[A-Za-z0-9.+:%~_-]+\.deb',filename):
        raise RuntimeError('Unexpected package URL or filename')
    package,version,_=unquote(filename).rsplit('_',2)
    metadata=subprocess.check_output(['apt-cache','show',package+'='+version],text=True)
    hashes=[]
    for paragraph in metadata.split('\n\n'):
        fields=dict(row.split(': ',1) for row in paragraph.splitlines() if ': ' in row and not row.startswith(' '))
        if fields.get('Size')==size and Path(fields.get('Filename','')).name==unquote(filename):
            if re.fullmatch(r'[a-f0-9]{64}',fields.get('SHA256','')):hashes.append(fields['SHA256'])
    if len(set(hashes))!=1:raise RuntimeError('No unique signed-index SHA256 for '+package)
    cached=Path('/var/cache/apt/archives')/filename
    if cached.is_file() and cached.stat().st_size==int(size):
        with cached.open('rb') as package_file:
            if hashlib.file_digest(package_file,'sha256').hexdigest()==hashes[0]:continue
    entries.append(url+'\n dir=/var/cache/apt/archives\n out='+filename+'\n checksum=sha-256='+hashes[0]+'\n')
if entries:
    with tempfile.NamedTemporaryFile(mode='w') as source:
        source.write(''.join(entries));source.flush()
        subprocess.run(['aria2c','--input-file='+source.name,'--max-concurrent-downloads=4',
                        '--max-connection-per-server=8','--split=8','--min-split-size=1M',
                        '--file-allocation=none','--auto-file-renaming=false','--allow-overwrite=true',
                        '--continue=true','--max-tries=3','--retry-wait=3','--summary-interval=30',
                        '--console-log-level=warn'],check=True)
