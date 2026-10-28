"""Fetch checksum-pinned public SDK inputs for the native flight toolchain."""
import hashlib,json,pathlib,urllib.request
root=pathlib.Path('/opt/nos3-sdk')
manifest=json.loads((root/'manifest.json').read_text())
for entry in manifest['packages']:
    data=urllib.request.urlopen(entry['url'],timeout=120).read()
    if hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('SDK input hash mismatch: '+entry['file'])
    (root/entry['file']).write_bytes(data)
