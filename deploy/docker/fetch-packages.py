"""Prefetch an APT install plan concurrently; APT still verifies/install packages.

Only use URLs and SHA256 hashes selected from the authenticated APT indexes.
This avoids serial downloads making the full GUI image impractical on slow links.
"""
import concurrent.futures
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from urllib.parse import unquote, urlsplit

plan=subprocess.check_output(['apt-get','--print-uris','--yes','--no-install-recommends','install',*sys.argv[1:]],text=True)
entries=[]
packages=[]
for line in plan.splitlines():
    match=re.fullmatch(r"'([^']+)' ([^ ]+) ([0-9]+)(?: .*)?",line)
    if not match:
        if line.startswith("'"):raise RuntimeError('Unrecognized APT download entry')
        continue
    url,filename,size=match.groups()
    if urlsplit(url).scheme not in ('http','https') or not re.fullmatch(r'[A-Za-z0-9.+:%~_-]+\.deb',filename):
        raise RuntimeError('Unexpected APT download entry')
    package,version,_=unquote(filename).rsplit('_',2)
    entries.append((url,filename,int(size)))
    packages.append(package+'='+version)
if not entries:sys.exit(0)
metadata=subprocess.check_output(['apt-cache','show',*packages],text=True)
hashes={}
for paragraph in metadata.split('\n\n'):
    fields=dict(row.split(': ',1) for row in paragraph.splitlines() if ': ' in row and not row.startswith(' '))
    if re.fullmatch(r'[a-f0-9]{64}',fields.get('SHA256','')):
        hashes[(Path(fields.get('Filename','')).name,int(fields.get('Size','0')))]=fields['SHA256']
cache=Path('/var/cache/apt/archives')
cache.mkdir(parents=True,exist_ok=True)
def download(entry):
    url,filename,size=entry
    expected=hashes.get((unquote(Path(urlsplit(url).path).name),size))
    if not expected:raise RuntimeError('Missing signed-index SHA256 for '+filename)
    target=cache/filename
    def valid(file):
        if not file.exists() or file.stat().st_size!=size:return False
        with file.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()==expected
    if valid(target):return
    partial=cache/(filename+'.download')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=60) as response,partial.open('wb') as output:
                count=0
                while chunk:=response.read(256*1024):
                    count+=len(chunk)
                    if count>size:raise RuntimeError('Package exceeds signed size')
                    output.write(chunk)
            if not valid(partial):raise RuntimeError('Package hash mismatch: '+filename)
            os.replace(partial,target)
            return
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt==2:raise
            time.sleep(2)
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    futures=[pool.submit(download,entry) for entry in entries]
    for index,future in enumerate(concurrent.futures.as_completed(futures),1):
        future.result()
        if index%25==0 or index==len(entries):print(f'Verified {index}/{len(entries)} APT packages',flush=True)
