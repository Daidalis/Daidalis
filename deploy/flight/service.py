"""Fixed flight-worker RPC over a private Unix socket; no Docker daemon access."""
import base64,hashlib,json,os,pathlib,signal,socket,socketserver,subprocess,tempfile,threading,time,uuid
ROOT=pathlib.Path('/srv/manta');SOCKET=pathlib.Path('/flight-control/flight.sock');LOCK=threading.Lock()
assert os.getuid()!=0 and os.environ.get('MANTA_FLIGHT_CONTAINER')=='1'
SHA=lambda b:hashlib.sha256(b).hexdigest()
def checked_source(baseline):
    manifest=json.loads((ROOT/'source/manifest.json').read_text())
    pinned=json.loads(pathlib.Path('/opt/manta/deploy/docker/nos3-sources.json').read_text())
    if manifest!=pinned:raise ValueError('Native source manifest changed')
    root=next(e for e in manifest if e['repo']=='nasa/nos3' and not e.get('path'))
    if baseline.get('revision')!=root['revision']:raise ValueError('NOS3 source revision mismatch')
    requested={e['path']:e['revision'] for e in baseline.get('submodules',[])}
    for e in manifest:
        if e.get('path') not in (None,'42') and requested.get(e['path'])!=e['revision']:raise ValueError('NOS3 submodule mismatch: '+e['path'])
    for e in baseline.get('sourceFiles',[]):
        p=pathlib.PurePosixPath(e['path'])
        if p.is_absolute() or '..' in p.parts or SHA((ROOT/'source/nos3'/p).read_bytes())!=e['sha256']:raise ValueError('NOS3 source file mismatch')
    return {'revision':root['revision'],'archives':manifest,'manifestSha256':SHA((ROOT/'source/manifest.json').read_bytes())}
class Handler(socketserver.StreamRequestHandler):
    def gone(self):
        try:return self.connection.recv(1,socket.MSG_PEEK|socket.MSG_DONTWAIT)==b''
        except BlockingIOError:return False
    def run_process(self,argv,input=None,timeout=600):
        with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
            proc=subprocess.Popen(argv,stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True,env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MANTA_BUILD_JOBS':'4'})
            try:
                if input is not None:proc.stdin.write(json.dumps(input).encode());proc.stdin.close()
                deadline=time.monotonic()+timeout
                while proc.poll() is None:
                    if self.gone():raise RuntimeError('Flight client disconnected')
                    if time.monotonic()>deadline:raise RuntimeError('Flight execution timed out')
                    if out.tell()+err.tell()>40*1024*1024:raise RuntimeError('Flight output exceeds bound')
                    time.sleep(.1)
                out.seek(0);err.seek(0);return proc.returncode,out.read(),err.read()
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid,signal.SIGTERM)
                    try:proc.wait(timeout=20)
                    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    def handle(self):
        try:
            raw=self.rfile.readline(8*1024*1024+1)
            if not raw.endswith(b'\n') or len(raw)>8*1024*1024:raise ValueError('Invalid flight RPC size')
            req=json.loads(raw)
            if req.get('method')=='status':
                self.wfile.write(json.dumps({'ok':True,'result':self.dispatch(req)}).encode()+b'\n');return
            while not LOCK.acquire(timeout=.2):
                if self.gone():return
            try:result=self.dispatch(req)
            finally:LOCK.release()
            response={'ok':True,'result':result}
        except Exception as error:response={'ok':False,'error':str(error)[:3000]}
        try:self.wfile.write(json.dumps(response).encode()+b'\n')
        except (BrokenPipeError,ConnectionResetError):pass
    def dispatch(self,req):
        method=req.get('method');payload=req.get('payload')
        if method=='status':
            code,out,err=self.run_process(['python3','/opt/manta/deploy/flight/stf-container.py','--status'],timeout=20)
            stf=json.loads(out) if code==0 else {'ready':False,'reason':err.decode()[-1000:]}
            nos3=all((ROOT/p).is_file() for p in ['nos3/fsw/build/exe/cpu1/core-cpu1','nos3/sims/build/bin/nos3-single-simulator','42/42'])
            return {'ready':nos3,'workerReady':nos3,'state':'running' if nos3 else 'unavailable','type':'container','isolated':True,'tools':{'nos3-stf':{**stf,'id':'nos3-stf','available':stf.get('ready',False)}}}
        if method=='stf-template':
            files=[]
            for name in ['lc_def_wdt.c','lc_def_adt.c','sc_rts003.c','sc_rts026.c','sc_rts029.c']:
                content=(ROOT/'stf-low-power/cfg/nos3_defs/tables'/name).read_text()
                files.append({'path':'flight/original/'+name,'content':content,'sha256':SHA(content.encode())})
            manifest={'schema':'manta-stf-native-case-v1','caseType':'stf-low-power','recipeVersion':1,'upstream':{'nos3':'5a3bdee6be9a2c67fdf994ae6db56d5c60395302'},'sourceFiles':[{'variant':'original','path':f['path'],'sha256':f['sha256']} for f in files]}
            content=json.dumps(manifest,indent=2)+'\n'
            return [{'path':'flight/original.stf.json','content':content,'sha256':SHA(content.encode())},*files]
        if method=='stf':
            code,out,err=self.run_process(['python3','/opt/manta/deploy/flight/stf-container.py'],payload,timeout=480)
            if code:raise RuntimeError(err.decode()[-2000:])
            return json.loads(out)
        if method=='nos3':
            provenance=checked_source(payload['baseline'])
            if payload.get('scope')=='component' and not payload['baseline'].get('localComponentReady'):raise ValueError('Component execution requires the pinned generic_adcs submodule checked out in the project')
            if payload.get('scope') not in ('component','build','integration'):raise ValueError('Unsupported NOS3 scope')
            outdir=ROOT/'runs'/('rpc-'+uuid.uuid4().hex);outdir.mkdir(parents=True)
            if payload['scope']=='integration':argv=['python3','/opt/manta/vm/verification/verify_all.py','--out',str(outdir),'--duration','20']
            elif payload['scope']=='component':argv=['node','/opt/manta/deploy/flight/component.mjs',str(outdir)]
            else:argv=['bash','/opt/manta/vm/nos3-plan/build_native.sh','/srv/manta/nos3']
            code,out,err=self.run_process(argv,payload if payload['scope']=='component' else None,timeout=900);(outdir/'execution.log').write_bytes(out+err)
            if payload['scope'] in ('integration','component'):report=json.loads((outdir/'verification.json').read_text())
            else:
                report={'schema':'manta-nos3-verification-v1','scope':'build','passed':code==0,'fullNos3Simulation':False,'checks':[{'id':'native-build','criterion':'Upstream native cFS, simulator and 42 build succeeds','passed':code==0}],'telemetryFiles':[]}
                (outdir/'verification.json').write_text(json.dumps(report))
            if code not in (0,1):raise RuntimeError('NOS3 execution failed: '+err.decode()[-1000:])
            if payload['scope']=='integration' and report.get('passed'):
                ready_path=ROOT/'stf-low-power/ready.json'
                if ready_path.exists():
                    ready=json.loads(ready_path.read_text())
                    for entry in ready['binaries']:
                        if entry['path']=='/srv/manta/42/42':entry['sha256']=SHA((ROOT/'42/42').read_bytes())
                    ready['verifiedNos3RestorationSha256']=SHA((outdir/'verification.json').read_bytes())
                    ready_path.write_text(json.dumps(ready,indent=2))
            files=[];total=0
            for name in ['verification.json','execution.log',*report.get('telemetryFiles',[])]:
                p=pathlib.PurePosixPath(name)
                if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe evidence path')
                data=(outdir/p).read_bytes();total+=len(data)
                if len(data)>1500000 or total>2500000:raise ValueError('Native evidence exceeds response bound')
                files.append({'path':name,'contentBase64':base64.b64encode(data).decode(),'sha256':SHA(data)})
            return {**report,'status':'completed' if report['passed'] else 'failed','inputHash':payload['inputHash'],'baselineHash':payload['baseline']['baselineHash'],'sourceProvenance':provenance,'executions':[{'argv':argv,'exitCode':code,'log':'execution.log'}],'files':files,'environment':'dedicated-nonroot-flight-container'}
        raise ValueError('Unsupported flight RPC method')
class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
if __name__=='__main__':
    SOCKET.parent.mkdir(parents=True,exist_ok=True);SOCKET.unlink(missing_ok=True)
    server=Server(str(SOCKET),Handler);os.chmod(SOCKET,0o660)
    server.serve_forever()
