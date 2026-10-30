"""Native 42 container transport; keeps the reviewed model/asset/trajectory checks."""
import base64,hashlib,importlib.util,json,os,pathlib,signal,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
SOURCE=pathlib.Path('/opt/orbit42')
REFERENCE=ROOT/'vm/worker/orbit42-run.py'
ARCHIVE='80a90432fc83772e3002c0320e4d54d7d2a6db230a2eeedbf9747a87f553ae4c'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def profile():
    manifest=json.loads((SOURCE/'build.json').read_text())
    if manifest.get('schema')!='manta-container-orbit42-build-v1' or manifest.get('archiveSha256')!=ARCHIVE or manifest.get('binarySha256')!=sha(SOURCE/'42') or manifest.get('referenceWorkerSha256')!=sha(REFERENCE):
        raise ValueError('42 build receipt, binary or reference worker differs from the installed image')
    return {**manifest,'adapterSha256':sha(REFERENCE),'containerAdapterSha256':sha(pathlib.Path(__file__))}
try:
    build=profile()
    if sys.argv[1]=='status':
        print(json.dumps({'ready':True,'state':'ready','isolated':os.environ.get('MANTA_BROKER_TASK')=='1','isolation':'rootless-task-container' if os.environ.get('MANTA_BROKER_TASK')=='1' else 'shared-container','hostGlobalChanges':False,'tool':{'id':'nasa-42',**build}}))
    else:
        spec=importlib.util.spec_from_file_location('reference_orbit42',REFERENCE);worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        worker.SOURCE=SOURCE;worker.BINARY=SOURCE/'42';worker.EXPECTED_BINARY_SHA256=build['binarySha256']
        original_assets=worker.verified_assets
        def assets():
            result=original_assets(SOURCE)
            result.pop('sourceIntegritySha256');result.pop('assetManifestSha256')
            result['archiveSha256']=ARCHIVE
            return result
        worker.verified_assets=assets
        def native_args(work):
            os.chdir(work)
            return [str(worker.BINARY),str(work/'InOut'),str(SOURCE/'Model')]
        worker.native_args=native_args
        signal.signal(signal.SIGTERM,worker.terminate);signal.signal(signal.SIGINT,worker.terminate)
        request,model,epoch=worker.read_request()
        with tempfile.TemporaryDirectory(prefix='manta-orbit42-') as temporary:
            worker.JOBS=pathlib.Path(temporary)
            result=worker.run(request,model,epoch)
            receipt=result['receipt'];receipt['isolation']='rootless-task-container; network disabled' if os.environ.get('MANTA_BROKER_TASK')=='1' else 'shared-container; same application UID/filesystem/network'
            receipt['containerAdapterSha256']=build['containerAdapterSha256'];receipt['build']=build
            for file in result['files']:
                if file['path']=='receipt.json':
                    data=(json.dumps(receipt,indent=2)+'\n').encode();file['contentBase64']=base64.b64encode(data).decode();file['sha256']=hashlib.sha256(data).hexdigest()
            print(json.dumps(result))
except Exception as error:
    print(json.dumps({'ready':False,'state':'unavailable','schema':'manta-orbit42-native-response-v1','success':False,'exitCode':1,'diagnostics':str(error),'reason':str(error),'files':[]}))
