"""Reuse the reviewed GIS algorithm with an image-specific toolchain receipt."""
import os,hashlib,json,pathlib,resource,runpy,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
WORKER=ROOT/'vm/worker/geospatial-run.py'

def probe():
    from osgeo import gdal,osr,_ogr,_osr
    names=['python3-gdal','gdal-bin','proj-bin']
    packages=dict(row.split('=',1) for row in subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n',*names],text=True).splitlines())
    pinned=dict(row.split('\t',1) for row in pathlib.Path('/opt/runner/packages.txt').read_text().splitlines())
    if any(pinned.get(name)!=value for name,value in packages.items()):raise ValueError('GIS packages differ from image build manifest')
    binaries={name:{'path':str(pathlib.Path(file).resolve()),'sha256':hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()} for name,file in {'ogrinfo':'/usr/bin/ogrinfo','ogr2ogr':'/usr/bin/ogr2ogr','pythonOgr':_ogr.__file__,'pythonOsr':_osr.__file__}.items()}
    state={'schema':'manta-container-geospatial-ready-v1','ready':True,'status':'ready','isolated':os.environ.get('MANTA_BROKER_TASK')=='1','isolation':'rootless-task-container' if os.environ.get('MANTA_BROKER_TASK')=='1' else 'shared-container','hostGlobalChanges':False,'packages':packages,'binaryHashes':binaries,'workerSha256':hashlib.sha256(WORKER.read_bytes()).hexdigest(),'versions':{'gdal':gdal.VersionInfo('--version'),'proj':'%d.%d.%d'%(osr.GetPROJVersionMajor(),osr.GetPROJVersionMinor(),osr.GetPROJVersionMicro())}}
    state['receiptSha256']=hashlib.sha256(json.dumps(state,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return state

if __name__=='__main__':
    try:
        state=probe()
        if sys.argv[1]=='status':print(json.dumps(state))
        else:
            resource.setrlimit(resource.RLIMIT_CPU,(120,120))
            resource.setrlimit(resource.RLIMIT_FSIZE,(140*1024*1024,140*1024*1024))
            resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
            # Worker validates ZIP paths/sizes, CRS, input hash and point count.
            runpy.run_path(str(WORKER),run_name='__main__')
    except Exception as error:
        print(json.dumps({'ready':False,'status':'unavailable','reason':str(error),'isolated':os.environ.get('MANTA_BROKER_TASK')=='1','isolation':'rootless-task-container' if os.environ.get('MANTA_BROKER_TASK')=='1' else 'shared-container'}))
