"""Per-project GUI sessions in one trusted personal desktop container."""
import base64
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import select
import socket
import socketserver
import subprocess
import threading
import time

SOCKET='/desktop-control/desktop.sock'
WIDTH,HEIGHT=1280,800
# Fixed launchers: packaged open-source tools and optional user-supplied Linux
# applications. Never take an executable or command line from an agent request.
TOOLS={'openscad':['/usr/bin/openscad'],'terminal':['/usr/bin/xterm'],
       'omedit':['/usr/bin/OMEdit'],'freecad':['/usr/bin/freecad'],
       'scilab':['/usr/bin/scilab'],
       'capella':['/opt/manta-desktop/capella/capella'],
       'papyrus':['/opt/manta-desktop/papyrus/papyrus'],
       'matlab':['/opt/manta-desktop/matlab/bin/matlab'],
       'dymola':['/opt/manta-desktop/dymola/bin/dymola'],
       'amesim':['/opt/manta-desktop/amesim/amesim']}
DOCUMENTS={'openscad':{'.scad'},'omedit':{'.mo'},
           'freecad':{'.fcstd','.step','.stp','.iges','.igs','.stl'},
           'scilab':{'.sce','.sci'}}

KEYS={'Enter':'Return','Tab':'Tab','Escape':'Escape','Backspace':'BackSpace','Delete':'Delete',
      'ArrowLeft':'Left','ArrowRight':'Right','ArrowUp':'Up','ArrowDown':'Down','Space':'space'}
guard=threading.Lock()
owner=None
sessions={}
active_port=6080
active_workspace=Path('/desktop-data')
version=0
processes=[]
PASSWORD=Path('/desktop-data/vnc-password.txt')


def execute(argv):
    return subprocess.run(argv,check=True,capture_output=True,timeout=12).stdout


def start(index=0,home=None):
    global processes,active_port
    display=99+index
    active_port=6080+index
    os.environ['DISPLAY']=f':{display}'
    # Solver workers use offscreen Qt; interactive engineering applications need X11.
    os.environ['QT_QPA_PLATFORM']='xcb'
    os.environ['LIBGL_ALWAYS_SOFTWARE']='1'
    # Mesa otherwise sizes its llvmpipe pool from the host CPU count.
    os.environ['LP_NUM_THREADS']='2'
    if home:
        home.mkdir(parents=True,exist_ok=True)
        os.environ['HOME']=str(home)
        os.environ['XDG_CONFIG_HOME']=str(home/'.config')
    if not PASSWORD.exists():
        PASSWORD.write_text(secrets.token_urlsafe(6));PASSWORD.chmod(0o600)
    execute(['x11vnc','-storepasswd',PASSWORD.read_text().strip(),'/tmp/vnc-auth'])
    processes=[subprocess.Popen(['Xvfb',f':{display}','-screen','0',f'{WIDTH}x{HEIGHT}x24','-nolisten','tcp'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)]
    for _ in range(50):
        if Path(f'/tmp/.X11-unix/X{display}').exists():break
        time.sleep(.1)
    processes += [subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) for cmd in [
        ['openbox'],
        ['x11vnc','-display',f':{display}','-forever','-shared','-localhost','-rfbport',str(5900+index),'-rfbauth','/tmp/vnc-auth'],
        ['websockify','--web=/usr/share/novnc',str(active_port),f'127.0.0.1:{5900+index}'],
    ]]


def action(req):
    global owner,version,processes,active_port,active_workspace
    op=req.get('action');project=req.get('projectId');args=req.get('args') or {}
    tools=[{'id':key,'name':key,'installed':Path(value[0]).is_file() and os.access(value[0],os.X_OK)} for key,value in TOOLS.items()]
    if op=='status':
        if any(p.poll() is not None for p in processes):
            raise RuntimeError('A virtual desktop process stopped; inspect the desktop service')
        geometry=execute(['xdotool','getdisplaygeometry']).decode().strip()
        if geometry!=f'{WIDTH} {HEIGHT}':raise RuntimeError('Virtual display geometry probe failed')
        return {'available':True,'status':'ready','tools':tools,'projectId':owner,'width':WIDTH,'height':HEIGHT,'scope':'container-desktop'}
    if not isinstance(project,str) or not re.fullmatch(r'project_[a-f0-9-]+',project):
        raise ValueError('Valid project required')
    if op=='desktop.enable':
        workspace=Path(args.get('workspace','')).resolve(strict=True)
        if not workspace.is_dir() or not (workspace==Path('/work') if os.environ.get('MANTA_BROKER_TASK')=='1' else workspace.is_relative_to(Path('/projects')) and workspace!=Path('/projects')):
            raise ValueError('Desktop requires a managed project directory under /projects')
        if project not in sessions:
            if len(sessions)>=3:
                raise ValueError('Three desktop sessions are already open. Save work and restart the desktop service to release sessions.')
            index=len(sessions)
            if index==0:
                # The unassigned display started for readiness can be reused.
                home=Path('/desktop-data')/project
                home.mkdir(parents=True,exist_ok=True)
            else:
                home=Path('/desktop-data')/project
                start(index,home)
            sessions[project]={'index':index,'processes':processes,'workspace':workspace,'home':home,'apps':{}}
        selected=sessions[project]
        if selected['workspace']!=workspace:raise ValueError('Project workspace changed; restart desktop after saving work')
        processes=selected['processes']
        active_port=6080+selected['index']
        os.environ['DISPLAY']=f":{99+selected['index']}"
        os.environ['HOME']=str(selected['home'])
        os.environ['XDG_CONFIG_HOME']=str(selected['home']/'.config')
        active_workspace=workspace
        owner=project
        version+=1
        return {'ok':True,'workspace':str(workspace),'sessionCount':len(sessions)}
    if owner!=project:raise ValueError('Enable this project desktop first')
    if op=='desktop.disable':
        # Retain ownership: disabling is not permission to expose the old desktop to another project.
        return {'ok':True}
    if op not in ('desktop.screenshot','desktop.apps') and args.get('screenVersion')!=version:
        raise ValueError('Stale screenVersion; take a fresh screenshot before acting')
    if op=='desktop.apps':return {'tools':tools}
    if op=='desktop.screenshot':
        data=execute(['import','-window','root','png:-'])
        if len(data)>8*1024*1024:raise ValueError('Screenshot too large')
        return {'ok':True,'contentBase64':base64.b64encode(data).decode(),'width':WIDTH,'height':HEIGHT,'pixelWidth':WIDTH,'pixelHeight':HEIGHT,'screenVersion':version,'scope':'container-desktop'}
    if op=='desktop.open_app':
        tool=args.get('toolId')
        if tool not in TOOLS or not (Path(TOOLS[tool][0]).is_file() and os.access(TOOLS[tool][0],os.X_OK)):raise ValueError('Application not installed')
        argv=list(TOOLS[tool])
        if args.get('path') is not None:
            target=(active_workspace/args['path']).resolve(strict=True)
            if not target.is_relative_to(active_workspace) or not target.is_file():raise ValueError('File must be inside the active project')
            if target.suffix.lower() not in DOCUMENTS.get(tool,set()):raise ValueError('Unsupported document type for this application')
            if tool=='scilab':argv.append('-f')
            argv.append(str(target))
        if tool=='omedit' and Path('/opt/modelica-libraries').is_dir():
            # Use the same offline standard-library registry as the solver.
            registry=Path(os.environ['HOME'])/'.openmodelica/libraries'
            registry.mkdir(parents=True,exist_ok=True)
            for entry in Path('/opt/modelica-libraries').iterdir():
                target=registry/entry.name
                if not target.exists():
                    if entry.is_dir():target.symlink_to(entry,target_is_directory=True)
                    else:target.write_bytes(entry.read_bytes())
        apps=sessions[project]['apps']
        for key,child in list(apps.items()):
            if child.poll() is not None:del apps[key]
        key=tuple(argv)
        if key in apps:
            windows=execute(['xdotool','search','--onlyvisible','--pid',str(apps[key].pid)]).decode().split()
            if not windows:raise ValueError('Application has no visible window yet; retry after it starts')
            execute(['xdotool','windowactivate','--sync',windows[-1]])
        else:
            if len(apps)>=4:raise ValueError('Four applications are already open in this project; save and close a window before opening another')
            # Keep library/Qt worker pools within the desktop CPU budget as well.
            cpus=sorted(os.sched_getaffinity(0))[:2]
            current=Path('/sys/fs/cgroup/pids.current')
            maximum=Path('/sys/fs/cgroup/pids.max')
            if current.exists() and maximum.exists():
                limit=maximum.read_text().strip()
                if limit!='max' and int(limit)-int(current.read_text())<80:
                    raise ValueError('Desktop process budget is low; save and close unused applications before opening another')
            apps[key]=subprocess.Popen(['/usr/bin/taskset','-c',','.join(map(str,cpus))]+argv,
                                       cwd=active_workspace,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    elif op=='desktop.click':
        x,y=args.get('x'),args.get('y')
        if not all(isinstance(v,(int,float)) for v in (x,y)) or not 0<=x<WIDTH or not 0<=y<HEIGHT:raise ValueError('Click outside desktop')
        execute(['xdotool','mousemove','--sync',str(round(x)),str(round(y)),'click','1'])
    elif op=='desktop.type':
        text=args.get('text')
        if not isinstance(text,str) or len(text)>4000:raise ValueError('Invalid text')
        execute(['xdotool','type','--clearmodifiers','--',text])
    elif op=='desktop.key':
        if args.get('key') not in KEYS:raise ValueError('Unsupported key')
        execute(['xdotool','key','--clearmodifiers',KEYS[args['key']]])
    else:raise ValueError('Unsupported desktop operation')
    version+=1
    return {'ok':True,'screenVersion':version,'scope':'container-desktop'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n=int(self.headers.get('Content-Length','0'))
            if self.path!='/action' or not 0<n<=32000:raise ValueError('Invalid desktop request')
            with guard:result=action(json.loads(self.rfile.read(n)))
            body=json.dumps(result).encode();self.send_response(200)
        except Exception as error:
            body=json.dumps({'error':str(error)}).encode();self.send_response(400)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass


class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True


class VncRelay(socketserver.BaseRequestHandler):
    def handle(self):
        # One fixed destination; the desktop has no network route to the application.
        try:
            selected_port=active_port
            with socket.create_connection(('127.0.0.1',selected_port),timeout=10) as upstream:
                upstream.settimeout(30)
                self.request.settimeout(30)
                while selected_port==active_port:
                    ready,_,_=select.select([self.request,upstream],[],[],1)
                    if not ready:continue
                    for source in ready:
                        data=source.recv(65536)
                        if not data:return
                        (upstream if source is self.request else self.request).sendall(data)
        except OSError:
            pass


if __name__=='__main__':
    os.umask(0o077)
    if not shutil.which('Xvfb'):raise RuntimeError('Desktop toolchain not installed; rebuild with desktop group')
    start()
    vnc_socket='/desktop-control/novnc.sock'
    if os.path.exists(vnc_socket):os.unlink(vnc_socket)
    vnc=Server(vnc_socket,VncRelay)
    os.chmod(vnc_socket,0o600)
    threading.Thread(target=vnc.serve_forever,daemon=True).start()
    if os.path.exists(SOCKET):os.unlink(SOCKET)
    with Server(SOCKET,Handler) as server:
        os.chmod(SOCKET,0o600)
        print('Manta virtual desktop ready; VNC password is in /desktop-data/vnc-password.txt',flush=True)
        server.serve_forever()
