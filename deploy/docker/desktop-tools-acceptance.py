"""Real GUI smoke in a disposable offline image; one tool per container.

Run with --tmpfs /tmp, --tmpfs /desktop-data:uid=1000,gid=1000,
--tmpfs /work:uid=1000,gid=1000 and MANTA_BROKER_TASK=1.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

spec=importlib.util.spec_from_file_location('desktop','/opt/manta/deploy/desktop/service.py')
desktop=importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)
tool=sys.argv[1]
fixtures={
    'openscad':('MantaParity.scad','cube([2,3,4]);\n',r'openscad|OpenSCAD'),
    'omedit':('MantaParity.mo','model MantaParity\n Real x(start=1);\nequation\n der(x)=-x;\nend MantaParity;\n',r'OMEdit'),
    'freecad':('MantaParity.FCStd',None,r'freecad|FreeCAD'),
    'scilab':('MantaParity.sce','mputl(string(2+3),"/work/scilab-proof.txt");\n',r'Scilab|scilab'),
}
name,source,window_class=fixtures[tool]
if tool=='freecad':
    generator=Path('/work/create.py')
    generator.write_text('import FreeCAD, Part\ndoc=FreeCAD.newDocument("MantaParity")\ndoc.addObject("Part::Box","Box")\ndoc.recompute()\ndoc.saveAs("/work/MantaParity.FCStd")\ndoc.Box.Shape.exportStl("/work/MantaParity.stl")\n')
    subprocess.run(['/usr/bin/freecadcmd',str(generator)],input=b'',capture_output=True,check=True,timeout=30)
    name='MantaParity.FCStd'
    assert Path('/work',name).stat().st_size>100
else:Path('/work',name).write_text(source)
project='project_12345678-abcd'
def action(op,args=None):
    return desktop.action({'projectId':project,'action':'desktop.'+op,'args':args or {}})
original_popen=desktop.subprocess.Popen
launch_log=open('/tmp/desktop-tool-launch.log','wb')
def logged_popen(argv,**kwargs):
    if argv[0]=='/usr/bin/taskset':kwargs.update(stdout=launch_log,stderr=launch_log)
    return original_popen(argv,**kwargs)
desktop.subprocess.Popen=logged_popen
desktop.start()
action('enable',{'workspace':'/work'})
assert next(t for t in action('apps')['tools'] if t['id']==tool)['installed']
shot=action('screenshot')
action('open_app',{'toolId':tool,'path':name,'screenVersion':shot['screenVersion']})
for _ in range(120):
    found=subprocess.run(['xdotool','search','--onlyvisible','--class',window_class],capture_output=True,text=True)
    if found.returncode==0:
        main=[]
        for window in found.stdout.split():
            geometry=subprocess.run(['xdotool','getwindowgeometry','--shell',window],capture_output=True,text=True)
            fields=dict(line.split('=',1) for line in geometry.stdout.splitlines() if '=' in line)
            if int(fields.get('WIDTH','0'))>=700 and int(fields.get('HEIGHT','0'))>=500:main.append(window)
        if main and (tool!='scilab' or Path('/work/scilab-proof.txt').exists()):break
    time.sleep(.5)
else:raise RuntimeError('Engineering application did not open a visible window: '+tool)
if tool=='scilab':assert Path('/work/scilab-proof.txt').read_text().strip()=='5'
time.sleep(10 if tool=='freecad' else 2)
if tool=='freecad':
    # Headless-generated documents have no saved GUI visibility. Show the Box
    # through the same click/key/type driver used by Manta, then fit its view.
    shot=action('screenshot')
    action('click',{'x':100,'y':215,'screenVersion':shot['screenVersion']})
    shot=action('screenshot')
    action('key',{'key':'Space','screenVersion':shot['screenVersion']})
    shot=action('screenshot')
    action('type',{'text':'0vf','screenVersion':shot['screenVersion']})
    time.sleep(1)
shot=action('screenshot')
if os.environ.get('MANTA_GUI_EVIDENCE'):
    Path(os.environ['MANTA_GUI_EVIDENCE'],tool+'.log').write_bytes(Path('/tmp/desktop-tool-launch.log').read_bytes())
    Path(os.environ['MANTA_GUI_EVIDENCE'],tool+'.png').write_bytes(base64.b64decode(shot['contentBase64']))
assert base64.b64decode(shot['contentBase64']).startswith(b'\x89PNG\r\n\x1a\n')
names=[subprocess.check_output(['xdotool','getwindowname',window],text=True).strip() for window in main]
print(json.dumps({'tool':tool,'passed':True,'visibleWindows':names,'projectDocument':name}),flush=True)
