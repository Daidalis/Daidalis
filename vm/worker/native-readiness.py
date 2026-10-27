#!/usr/bin/env python3
"""Receipts for real ARM64 guest binaries and fixed staged NOS3 inputs."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import tarfile

ROOT=Path('/srv/manta')
STAGED=Path('/mnt/manta-transfer')
HERE=Path(__file__).resolve().parent
RECEIPT=ROOT/'receipts/native-ready.json'
BINARIES=[ROOT/'nos3/fsw/build/exe/cpu1/core-cpu1',ROOT/'42/42',ROOT/'nos3/sims/build/bin/nos3-single-simulator',Path('/usr/bin/nos_engine_server_standalone')]
class RuntimeChanged(RuntimeError):pass

def digest(file):
    result=hashlib.sha256()
    with Path(file).open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()

def inputs(verify=True):
    expected=json.loads((HERE/'native-inputs.json').read_text())
    for rel,sha in expected['stagedFiles'].items():
        if Path(rel).is_absolute() or '..' in Path(rel).parts:raise RuntimeError('Invalid staged input path')
        if verify and digest(STAGED/rel)!=sha:raise RuntimeError('Staged input integrity mismatch: '+rel)
    recipes={name:digest(HERE/name) for name in ['prepare-native.sh','native-readiness.py','native/provision_guest.sh','native/configure_native.py','native/build_native.sh']}
    snapshot={'stagedFiles':expected['stagedFiles'],'recipeFiles':recipes}
    return hashlib.sha256(json.dumps(snapshot,sort_keys=True,separators=(',',':')).encode()).hexdigest(),snapshot

def binaries():
    result=[]
    flight_root=ROOT/'nos3/fsw/build/exe/cpu1/cf'
    sim_root=ROOT/'nos3/sims/build/lib'
    for required in [flight_root/'generic_adcs.so',flight_root/'generic_st.so',sim_root/'libtruth_42_sim.so',sim_root/'libgeneric_star_tracker_sim.so',sim_root/'libnos_time_driver.so',sim_root/'libsim_common.so']:
        if not required.is_file():raise RuntimeError('Required native chain library missing: '+str(required))
    libraries=sorted(set(flight_root.glob('*.so'))|set(sim_root.glob('*.so')))
    for file in BINARIES+libraries:
        header=file.open('rb').read(64)
        if header[:4]!=b'\x7fELF' or header[4]!=2 or header[5]!=1 or struct.unpack_from('<H',header,18)[0]!=183:
            raise RuntimeError('Expected an actual 64-bit ARM ELF: '+str(file))
        if file in BINARIES and not os.access(file,os.X_OK):raise RuntimeError('Native binary is not executable: '+str(file))
        result.append({'path':str(file),'sha256':digest(file),'bytes':file.stat().st_size})
    return result

def checked_build_receipt(actual):
    entries={}
    for line in (ROOT/'receipts/binaries.sha256').read_text().splitlines():
        sha,name=line.split(maxsplit=1);entries[str(Path(name.strip().lstrip('*')).resolve())]=sha
    for item in actual[:3]:
        if entries.get(item['path'])!=item['sha256']:raise RuntimeError('Successful native build receipt does not match '+item['path'])

def private_assets():
    manifest=json.loads((STAGED/'42-assets-manifest.json').read_text())
    source={item['path']:item for item in json.loads((STAGED/'source/integrity.json').read_text())['files']}
    for name in ['Model','World']:
        if (ROOT/'42'/name).resolve()!=(ROOT/'42-assets'/name).resolve():raise RuntimeError('42 runtime assets must resolve to the private guest asset tree')
    count=0
    for name in manifest['kept']:
        relative=Path(name)
        if relative.is_absolute() or '..' in relative.parts:raise RuntimeError('Invalid 42 asset path')
        file=ROOT/'42-assets'/relative
        if not file.resolve().is_relative_to(ROOT/'42-assets'):raise RuntimeError('42 asset escapes the private guest tree')
        expected=source.get('42/'+name)
        if not expected or digest(file)!=expected['sha256']:raise RuntimeError('Private 42 asset integrity mismatch: '+name)
        count+=1
    return count

def record():
    input_hash,snapshot=inputs()
    actual=binaries();checked_build_receipt(actual);asset_count=private_assets()
    receipt={'schema':'manta-nos3-native-ready-v1','ready':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'architecture':'aarch64','inputHash':input_hash,'inputs':snapshot,'binaries':actual,'privateAssetCount':asset_count,'fullSimulationVerified':False}
    RECEIPT.parent.mkdir(parents=True,exist_ok=True)
    temporary=RECEIPT.with_suffix('.tmp');temporary.write_text(json.dumps(receipt,indent=2)+'\n');temporary.chmod(0o644);temporary.replace(RECEIPT)
    return {'ready':True,'reused':False,'inputHash':input_hash,'binaryCount':len(actual),'fullSimulationVerified':False}

def check():
    saved=json.loads(RECEIPT.read_text())
    input_hash,_=inputs()
    if saved.get('schema')!='manta-nos3-native-ready-v1' or saved.get('inputHash')!=input_hash:raise RuntimeError('Native preparation receipt is stale')
    actual=binaries()
    private_assets()
    if saved.get('binaries')!=actual:raise RuntimeChanged('Native app/library binaries changed after their recorded validation; existing work was preserved')
    return {'ready':True,'reused':True,'inputHash':input_hash,'binaryCount':len(actual),'fullSimulationVerified':False}

def extract_source():
    inputs()
    archive=STAGED/'nos3-source.tar.gz'
    # Fixed guest work roots only. Never edit or fetch the original host project.
    for work in [ROOT/'nos3',ROOT/'42',ROOT/'42-assets']:
        if work.is_symlink():work.unlink()
        elif work.exists():shutil.rmtree(work)
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar.getmembers():
            name=Path(member.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0]!='nos3' or member.issym() or member.islnk() or member.isdev():raise RuntimeError('Unsafe entry in pinned NOS3 source archive')
        tar.extractall(ROOT)
    (ROOT/'nos3/.manta-isolated-nos3').write_text('Private guest copy from checksum-verified pinned archive.\n')
    return {'sourcePrepared':True,'source':'pinned-local-archive'}

# Use explicit switch parsing because the operation itself begins with --.
import sys
if len(sys.argv)!=2 or sys.argv[1] not in ['--check','--record','--verify-inputs','--extract-source']:raise SystemExit('Expected one fixed readiness operation')
try:
    mode=sys.argv[1]
    result=check() if mode=='--check' else record() if mode=='--record' else extract_source() if mode=='--extract-source' else {'verified':True,'inputHash':inputs()[0]}
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({'ready':False,'reason':str(error),'preservedExistingBuild':isinstance(error,RuntimeChanged)}))
    raise SystemExit(3 if isinstance(error,RuntimeChanged) else 1)
