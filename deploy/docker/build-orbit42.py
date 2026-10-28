"""Build the public, hash-pinned NASA 42 release; verify every runtime asset."""
import hashlib,json,os,pathlib,platform,runpy,shutil,subprocess,tarfile,urllib.request
ARCHIVE_SHA='80a90432fc83772e3002c0320e4d54d7d2a6db230a2eeedbf9747a87f553ae4c'
cache=pathlib.Path('/var/cache/manta42');cache.mkdir(parents=True,exist_ok=True)
archive=cache/'dev_20260403.tar.gz'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if not archive.is_file() or sha(archive)!=ARCHIVE_SHA:
    with urllib.request.urlopen('https://codeload.github.com/nasa-itc/42/tar.gz/refs/tags/dev_20260403',timeout=180) as response,archive.open('wb') as output:
        shutil.copyfileobj(response,output)
if sha(archive)!=ARCHIVE_SHA:raise ValueError('42 source archive hash mismatch')
source=pathlib.Path('/tmp/build42');source.mkdir()
worker=runpy.run_path('/opt/orbit42-reference.py')
required=set(worker['EXPECTED_ASSET_SHA256'])|{'InOut/'+name for name in worker['EXPECTED_TEMPLATE_SHA256']}
with tarfile.open(archive) as stream:
    prefix=stream.getmembers()[0].name.split('/')[0]+'/'
    for member in stream.getmembers():
        name=member.name.removeprefix(prefix);p=pathlib.PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe source path')
        if not member.isfile():continue
        if name not in required and name!='Makefile' and p.parts[0] not in ('Source','Kit','Include','License','MetaCode'):continue
        target=source/name;target.parent.mkdir(parents=True,exist_ok=True)
        with stream.extractfile(member) as inp,target.open('wb') as out:shutil.copyfileobj(inp,out)
        os.utime(target,(member.mtime,member.mtime))
for name,expected in worker['EXPECTED_ASSET_SHA256'].items():
    if sha(source/name)!=expected:raise ValueError('42 asset differs: '+name)
for name,expected in worker['EXPECTED_TEMPLATE_SHA256'].items():
    if sha(source/'InOut'/name)!=expected:raise ValueError('42 template differs: '+name)
(source/'Object').mkdir(exist_ok=True)
subprocess.run(['make','-j2','GUIFLAG=','SHADERFLAG='],cwd=source,check=True)
out=pathlib.Path('/opt/orbit42');out.mkdir(exist_ok=True)
for name in ('42','InOut','Model','World','License'):
    src=source/name
    if src.is_dir():shutil.copytree(src,out/name)
    else:shutil.copy2(src,out/name)
manifest={'schema':'manta-container-orbit42-build-v1','repository':'nasa-itc/42','revision':'dev_20260403','archiveSha256':ARCHIVE_SHA,'binarySha256':sha(out/'42'),'architecture':platform.machine(),'compiler':subprocess.check_output(['gcc','--version'],text=True).splitlines()[0],'buildFlags':['GUIFLAG=','SHADERFLAG='],'referenceWorkerSha256':sha(pathlib.Path('/opt/orbit42-reference.py'))}
(out/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
shutil.rmtree(source)
