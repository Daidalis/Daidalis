"""Extract the exact public source archives recorded by the native build audit."""
import hashlib,json,os,pathlib,shutil,tarfile,urllib.request
base=pathlib.Path('/srv/manta/source');cache=pathlib.Path('/var/cache/manta-nos3');cache.mkdir(parents=True,exist_ok=True)
manifest=json.loads(pathlib.Path('/opt/nos3-build/sources.json').read_text())
for entry in manifest:
    archive=cache/(entry['archiveSha256']+'.tar.gz')
    if not archive.exists():
        with urllib.request.urlopen(entry['url'],timeout=180) as src,archive.open('wb') as dest:shutil.copyfileobj(src,dest)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=entry['archiveSha256']:raise ValueError('Source archive hash mismatch: '+entry['repo'])
    relative=entry.get('path');dest=base/'42' if relative=='42' else base/'nos3'/(relative or '')
    dest.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as tf:
        prefix=None
        for m in tf:
            p=pathlib.PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe source member')
            prefix=prefix or p.parts[0]
            if p.parts[0]!=prefix:raise ValueError('Inconsistent source archive root')
            if len(p.parts)<2:continue
            target=dest.joinpath(*p.parts[1:])
            if m.isdir():target.mkdir(parents=True,exist_ok=True)
            elif m.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with tf.extractfile(m) as src,target.open('wb') as out:shutil.copyfileobj(src,out)
                target.chmod(m.mode&0o777);os.utime(target,(m.mtime,m.mtime))
            elif m.issym():
                link=pathlib.PurePosixPath(m.linkname)
                if link.is_absolute() or '..' in link.parts:raise ValueError('Unsafe source link')
                target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(m.linkname)
            else:raise ValueError('Unsupported source archive member')
    print('Verified',entry['repo'],entry['revision'],flush=True)
(base/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
