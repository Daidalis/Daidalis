"""Full-duplex native runtime relay; Docker options remain broker-owned."""
import hashlib,json,os,select,socket,socketserver,subprocess,threading,time,uuid
from pathlib import Path

class NativeHandler(socketserver.StreamRequestHandler):
    def handle(self):
        broker=self.server.broker;name='manta-task-'+uuid.uuid4().hex;process=None;acquired=False
        try:
            self.connection.settimeout(15)
            raw=self.rfile.readline(24*1024*1024+1)
            if not raw.endswith(b'\n') or len(raw)>24*1024*1024:raise ValueError('Invalid native request')
            request=json.loads(raw)
            if set(request)!={'kind','runtime','project','options'} or request['kind'] not in ('native','service'):raise ValueError('Invalid native task')
            broker.validate_project(request['project'])
            service=request['kind']=='service'
            options=request['options']
            if not isinstance(options,dict):raise ValueError('Invalid session options')
            if service:
                if request['runtime'] not in ('computer','mcp'):raise ValueError('Invalid service runtime')
                if set(options)-({'projectId','baseUrl','allowedHosts'} if request['runtime']=='computer' else {'command','args','cwd','env'}):raise ValueError('Invalid service options')
            else:
                if request['runtime'] not in ('codex-app-server','claude-agent-sdk'):raise ValueError('Invalid native runtime')
                allowed={'model','sessionId','input','history','instructions','tools','permissionMode','maxTurns','apiKey','baseUrl'}
                if set(options)-allowed or options.get('baseUrl')!='http://127.0.0.1:18765/v1':raise ValueError('Invalid native options')
                if not isinstance(options.get('apiKey'),str) or len(options['apiKey'])!=64 or any(c not in '0123456789abcdef' for c in options['apiKey']):raise ValueError('Expected scoped proxy token')
            slots=broker.service_slots if service else broker.native_slots
            if not slots.acquire(blocking=False):raise RuntimeError('Session concurrency limit reached')
            acquired=True
            args=broker.container_args(name)
            args+=['--mount',f'type=volume,src={broker.volume},dst=/work,volume-subpath={request["project"]},volume-nocopy']
            if service:
                args+=['--tmpfs','/task-home:rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=700',
                       '--tmpfs','/desktop-data:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700']
            else:
                home='manta-native-'+hashlib.sha256((broker.owner+':'+request['project']).encode()).hexdigest()[:32]
                broker.docker('volume','create','--label','manta.native-state='+broker.owner,home)
                args+=['--mount',f'type=volume,src={home},dst=/task-home',
                       '--mount',f'type=volume,src={broker.model_volume},dst=/model-control,readonly,volume-nocopy']
            worker='service-worker.mjs' if service else 'native-worker.mjs'
            args+=['--entrypoint','node',broker.image,'/opt/manta/deploy/runner/'+worker]
            with broker.lock:broker.active.add(name)
            broker.docker(*args)
            process=subprocess.Popen(broker.cli+['start','--attach','--interactive',name],env=broker.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
            process.stdin.write(raw)
            self.connection.settimeout(15)
            # readline must not prefetch subsequent frames before this raw relay.
            deadline=time.monotonic()+3600000;sent=0;stderr=bytearray()
            while process.poll() is None:
                if time.monotonic()>deadline:raise RuntimeError('Native task timed out')
                streams,_,_=select.select([self.connection,process.stdout,process.stderr],[],[],.1)
                for stream in streams:
                    if stream is self.connection:
                        data=self.connection.recv(65536)
                        if not data:return
                        process.stdin.write(data)
                    else:
                        data=os.read(stream.fileno(),65536)
                        if stream is process.stdout:
                            sent+=len(data)
                            if sent>(512 if service else 128)*1024*1024:raise RuntimeError('Native output exceeds limit')
                            if data:self.connection.sendall(data)
                        elif data:stderr.extend(data[-4096:]);del stderr[:-4096]
            tail=process.stdout.read()
            if tail:self.connection.sendall(tail)
            if process.returncode:raise RuntimeError('Native task container exited unsuccessfully')
        except Exception as error:
            try:self.connection.sendall(json.dumps({'type':'error','message':str(error)}).encode()+b'\n')
            except OSError:pass
        finally:
            if acquired:
                try:broker.docker('rm','-f',name)
                except Exception:pass
                if process and process.poll() is None:process.kill();process.wait()
                with broker.lock:broker.active.discard(name)
                slots.release()

    rbufsize=0

class NativeServer(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    def __init__(self,*args):
        self.slots=threading.BoundedSemaphore(16)
        super().__init__(*args)
    def process_request(self,request,address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request);return
        super().process_request(request,address)
    def process_request_thread(self,request,address):
        try:super().process_request_thread(request,address)
        finally:self.slots.release()

def start(broker,path):
    endpoint=Path(path);endpoint.unlink(missing_ok=True)
    server=NativeServer(str(endpoint),NativeHandler);server.broker=broker;endpoint.chmod(0o660)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server
