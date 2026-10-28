import os
"""Transport verified native orbit snapshots to the unchanged ground-check worker."""
import base64,hashlib,importlib.util,io,json,pathlib,resource,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
WORKER=ROOT/'vm/worker/orbit-ground-run.py'
PIN='c7edd7901307227f2e2bda4a928c7db84925d2f8de4d7ef66665d99fa3e5ec08'
try:
    if hashlib.sha256(WORKER.read_bytes()).hexdigest()!=PIN:raise ValueError('Ground worker differs from reviewed hash')
    spec=importlib.util.spec_from_file_location('ground_worker',WORKER);worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
    if sys.argv[1]=='status':
        print(json.dumps({'ready':True,'state':'ready','isolated':os.environ.get('MANTA_BROKER_TASK')=='1','isolation':'rootless-task-container' if os.environ.get('MANTA_BROKER_TASK')=='1' else 'shared-container','workerSha256':PIN,'versions':worker.versions()}))
    else:
        raw=sys.stdin.buffer.read(52*1024*1024+1)
        if len(raw)>52*1024*1024:raise ValueError('Ground request too large')
        envelope=json.loads(raw);files=envelope.pop('nativeFiles')
        if not isinstance(files,dict) or set(files)!={'receipt.json','time.42','PosN.42','PosW.42'}:raise ValueError('Exact native evidence files required')
        sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(envelope).encode()))
        request,source=worker.read_request()
        resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(140*1024*1024,140*1024*1024))
        with tempfile.TemporaryDirectory(prefix='manta-ground-') as tmp:
            worker.JOBS=pathlib.Path(tmp);work=worker.JOBS/request['orbit']['jobId']/'work';out=work/'InOut';out.mkdir(parents=True)
            for name,encoded in files.items():
                if not isinstance(encoded,str) or len(encoded)>6*1024*1024:raise ValueError('Native snapshot too large')
                data=base64.b64decode(encoded,validate=True)
                if len(data)>4*1024*1024:raise ValueError('Native snapshot too large')
                ((work if name=='receipt.json' else out)/name).write_bytes(data)
            result=worker.run(request,source)
            result['workerSha256']=PIN
            print(json.dumps(result))
except Exception as error:
    print(json.dumps({'schema':'manta-orbit-ground-response-v1','success':False,'exitCode':2,'diagnostics':str(error),'reason':str(error),'ready':False,'state':'unavailable','isolated':False,'files':[]}))
