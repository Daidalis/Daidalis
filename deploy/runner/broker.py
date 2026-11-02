"""Narrow Unix-socket task API. Only this service can access the rootless daemon.

Clients cannot select images, volumes, Docker flags, environment, or network.
The application is trusted to select the current project; task code is not.
"""
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import uuid

MAX_REQUEST = 72*1024*1024
MAX_OUTPUT = 32*1024*1024
ISOLATION = dict(kind='rootless-task-container', isolated=True, network='none',
                 credentialsIsolated=True, daemonRootless=True,
                 scope='commands, native Agents and configured engineering adapters')


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError('Expected a task object')
    kind = payload.get('kind')
    fields = {
        'probe': {'kind', 'timeoutMs'},
        'command': {'kind', 'project', 'command', 'timeoutMs'},
        'adapter': {'kind', 'adapter', 'mode', 'input', 'timeoutMs'},
        'professional': {'kind', 'toolId', 'operation', 'sourceFiles', 'mainFile',
                         'modelName', 'parameters', 'simulation', 'inputHash', 'timeoutMs', 'jobId', 'signals'},
    }
    if kind not in fields or set(payload) - fields[kind]:
        raise ValueError('Unsupported task or fields')
    timeout = payload.get('timeoutMs', 30000)
    maximum = (1800000 if payload.get('adapter') == 'flight' else 960000) if kind == 'adapter' else 600000 if kind == 'professional' else 60000
    if type(timeout) not in (int, float) or not 100 <= timeout <= maximum:
        raise ValueError('Invalid task timeout')
    if kind == 'adapter':
        if payload.get('adapter') not in ('gis','orbit42','ground','flight','numerical') or payload.get('mode') not in ('status','run','nos3'):
            raise ValueError('Invalid fixed adapter')
        if not isinstance(payload.get('input',''),str):raise ValueError('Adapter input must be text')
    if kind == 'command':
        if not isinstance(payload.get('project'), str) or not re.fullmatch(r'project-[A-Za-z0-9_-]{1,100}', payload['project']):
            raise ValueError('Only a managed project directory may be mounted')
        command = payload.get('command')
        if not isinstance(command, str) or not command.strip() or len(command) > 16000 or '\0' in command:
            raise ValueError('Invalid command')
    return {**payload, 'timeoutMs': timeout}


class Broker:
    def __init__(self):
        endpoint = os.environ['MANTA_TASK_DOCKER_HOST']
        if not endpoint.startswith('unix://'):
            raise ValueError('A local rootless Docker Unix socket is required')
        self.cli = ['docker', '--host', endpoint]
        self.env = {'PATH': os.environ['PATH'], 'HOME': '/tmp', 'DOCKER_CONFIG': '/tmp/manta-docker-config', 'GOMAXPROCS': '2'}
        self.volume = os.environ['MANTA_TASK_PROJECTS_VOLUME']
        self.owner = os.environ.get('MANTA_BROKER_ID', 'manta')
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', self.volume) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', self.owner):
            raise ValueError('Invalid deployment identity')
        info = json.loads(self.docker('info', '--format', '{{json .}}'))
        if 'name=rootless' not in info.get('SecurityOptions', []):
            raise RuntimeError('Broker refuses a rootful Docker daemon')
        if info.get('CgroupVersion') != '2' or info.get('CgroupDriver') != 'systemd' or any(not info.get(k) for k in ('MemoryLimit', 'PidsLimit')):
            raise RuntimeError('Rootless cgroup v2 memory and PID limits are required')
        self.cpus = os.environ.get('MANTA_TASK_CPUS', '2')
        if self.cpus not in ('0', '1', '2', '4'):
            raise ValueError('MANTA_TASK_CPUS must be 0, 1, 2 or 4')
        if self.cpus != '0' and not info.get('CpuCfsQuota'):
            raise RuntimeError('CPU controller not delegated; explicitly set MANTA_TASK_CPUS=0 to run without a CPU quota')
        self.isolation = {**ISOLATION, 'resources': {'memoryBytes': 2*1024**3, 'pids': 256,
                          'cpuQuota': int(self.cpus) or None, 'concurrentTasks': 4}}
        self.image = self.docker('image', 'inspect', os.environ['MANTA_TASK_IMAGE'], '--format', '{{.Id}}').strip()
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', self.image):
            raise RuntimeError('Task image must already exist locally')
        self.docker('volume', 'inspect', self.volume)
        self.model_volume = os.environ.get('MANTA_MODEL_VOLUME', '')
        self.flight_image = None
        if os.environ.get('MANTA_TASK_FLIGHT_IMAGE'):
            self.flight_image = self.docker('image','inspect',os.environ['MANTA_TASK_FLIGHT_IMAGE'],'--format','{{.Id}}').strip()
        self.slots = threading.BoundedSemaphore(4)
        self.probe_slots = threading.BoundedSemaphore(1)
        # Include the coordinator plus the default four workers; still a fixed deployment limit.
        self.native_slots = threading.BoundedSemaphore(8)
        self.service_slots = threading.BoundedSemaphore(8)
        self.lock = threading.Lock()
        self.active = set()
        # Only containers in this deployment's dedicated label namespace.
        for name in self.docker('ps', '-aq', '--filter', 'label=manta.broker='+self.owner).split():
            self.docker('rm', '-f', name)

    def docker(self, *args):
        result = subprocess.run(self.cli + list(args), env=self.env, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr.decode(errors='replace')[-2000:])
        return result.stdout.decode()

    def validate_project(self,project):
        if not isinstance(project,str) or not re.fullmatch(r'project-[A-Za-z0-9_-]{1,100}',project):
            raise ValueError('Invalid managed project')

    def container_args(self,name,flight=False):
        args=['create','--name',name,'--label','manta.broker='+self.owner,
              '--interactive','--network','none','--user','1000:1000','--cap-drop','ALL',
              '--security-opt','no-new-privileges=true','--pids-limit','512' if flight else '256',
              '--memory','8g' if flight else '2g','--memory-swap','8g' if flight else '2g',
              '--ulimit','nofile=1024:1024','--log-driver','none','--workdir','/work',
              '--tmpfs','/tmp:rw,nosuid,nodev,exec,size=1g,mode=1777']
        if not flight:args+=['--read-only','--ulimit','fsize=268435456:268435456']
        else:args+=['--sysctl','fs.mqueue.msg_max=128','--ulimit','msgqueue=819200:819200',
                    '--add-host','nos-engine-server:127.0.0.1','--add-host','truth42sim:127.0.0.1','--add-host','fortytwo:127.0.0.1']
        if self.cpus!='0':args+=['--cpus',self.cpus]
        for value in ['MANTA_BROKER_TASK=1','HOME=/task-home','TMPDIR=/tmp','LANG=C.UTF-8','OMP_NUM_THREADS=1',
                      'OPENBLAS_NUM_THREADS=1','MKL_NUM_THREADS=1','QT_QPA_PLATFORM=offscreen','LIBGL_ALWAYS_SOFTWARE=1']:
            args+=['--env',value]
        return args

    def run(self, payload, disconnected=lambda: False):
        payload = validate(payload)
        slots=self.probe_slots if payload['kind']=='probe' or payload.get('mode')=='status' else self.slots
        queue_deadline=time.monotonic()+30
        while not slots.acquire(timeout=.1):
            if disconnected():raise RuntimeError('Cancelled while queued')
            if time.monotonic()>queue_deadline:raise RuntimeError('Task queue wait exceeded 30 seconds')
        name = 'manta-task-'+uuid.uuid4().hex
        process = None
        created = False
        try:
            flight=payload.get('adapter')=='flight'
            if flight and not self.flight_image:raise RuntimeError('NOS3 task image is not configured')
            args=self.container_args(name,flight=flight)
            args += ['--entrypoint','/usr/bin/python3','--tmpfs','/task-home:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700']
            if payload['kind'] == 'command':
                # Docker resolves volume-subpath inside the fixed named volume;
                # a client can never supply an arbitrary host bind mount.
                args += ['--mount', f'type=volume,src={self.volume},dst=/work,volume-subpath={payload["project"]},volume-nocopy']
            else:
                args += ['--tmpfs', '/work:rw,nosuid,nodev,exec,size=512m,uid=1000,gid=1000,mode=700']
            args += [self.flight_image if flight else self.image, '-B', '/opt/manta/deploy/runner/task-worker.py']
            # Track before create so shutdown also covers container creation.
            with self.lock:
                self.active.add(name)
            self.docker(*args)
            created = True
            if disconnected():
                raise RuntimeError('Cancelled')
            with tempfile.TemporaryFile() as stdin, tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
                stdin.write(json.dumps(payload).encode()+b'\n'); stdin.seek(0)
                process = subprocess.Popen(self.cli+['start', '--attach', '--interactive', name], env=self.env,
                                           stdin=stdin, stdout=stdout, stderr=stderr)
                deadline = time.monotonic() + payload['timeoutMs']/1000 + 5
                while process.poll() is None:
                    if disconnected():
                        raise RuntimeError('Cancelled')
                    if time.monotonic() > deadline:
                        raise RuntimeError('Task timed out')
                    if os.fstat(stdout.fileno()).st_size + os.fstat(stderr.fileno()).st_size > MAX_OUTPUT:
                        raise RuntimeError('Task output exceeds limit')
                    time.sleep(.05)
                stdout.seek(0); stderr.seek(0)
                output, error = stdout.read(MAX_OUTPUT+1), stderr.read(MAX_OUTPUT+1)
                if len(output)+len(error) > MAX_OUTPUT:
                    raise RuntimeError('Task output exceeds limit')
                if process.returncode:
                    raise RuntimeError(error.decode(errors='replace')[-2000:] or 'Task container failed')
                result = json.loads(output)
                # The task cannot attest its own isolation: broker sets this field.
                return {**result, 'brokerIsolation': self.isolation, **({'isolation': self.isolation} if payload['kind']!='adapter' else {}), 'imageId': self.flight_image if flight else self.image}
        finally:
            try:
                # Even a timed-out create call may have reached the daemon.
                try:
                    self.docker('rm', '-f', name)
                except Exception:
                    if created:
                        raise
            finally:
                if process and process.poll() is None:
                    process.kill(); process.wait()
                with self.lock:
                    self.active.discard(name)
                slots.release()

    def close(self):
        with self.lock:
            names = list(self.active)
        for name in names:
            try:
                self.docker('rm', '-f', name)
            except Exception:
                pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    # Bound connections as well as the expensive container operations.
    def __init__(self, *args):
        self.connections = threading.BoundedSemaphore(16)
        super().__init__(*args)

    def process_request(self, request, address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        super().process_request(request, address)

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if self.path != '/task' or not 0 < length <= MAX_REQUEST or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid task request')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('Incomplete request')
            def disconnected():
                return bool(select.select([self.connection], [], [], 0)[0]) and self.connection.recv(1, socket.MSG_PEEK) == b''
            result = self.server.broker.run(json.loads(raw), disconnected)
            status = 200
        except Exception as error:
            result, status = {'error': str(error)}, 400
        data = json.dumps(result).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    if os.geteuid() == 0:
        raise RuntimeError('Broker must run as a non-root user')
    endpoint = Path(os.environ.get('MANTA_BROKER_SOCKET', '/broker-control/broker.sock'))
    lock = open(str(endpoint)+'.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # Never remove another live broker's socket.
    if endpoint.exists():
        with socket.socket(socket.AF_UNIX) as connection:
            try:
                connection.connect(str(endpoint))
            except ConnectionRefusedError:
                endpoint.unlink()
            else:
                raise RuntimeError('Broker already running')
    broker = Broker()
    server = Server(str(endpoint), Handler)
    server.broker = broker
    endpoint.chmod(0o660)
    native=None
    if broker.model_volume:
        import importlib.util
        spec=importlib.util.spec_from_file_location('native_broker',Path(__file__).with_name('native-broker.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        native=module.start(broker,str(endpoint.with_name('native.sock')))
    def stop(*args):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=.1)
    finally:
        if native:native.shutdown();native.server_close()
        broker.close(); server.server_close(); endpoint.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
