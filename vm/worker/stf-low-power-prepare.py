#!/usr/bin/env python3
import pathlib,json,hashlib,fcntl
_root=pathlib.Path('/srv/manta/stf-low-power');_root.mkdir(exist_ok=True);_lock=(_root/'native-run.lock').open('a');fcntl.flock(_lock,fcntl.LOCK_EX)
try:
 _r=json.loads((_root/'ready.json').read_text())
 if _r.get('recipeVersion')==1 and _r.get('ready') and _r.get('prepareRecipeSha256')==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest() and all(hashlib.sha256(pathlib.Path(x['path']).read_bytes()).hexdigest()==x['sha256'] for x in _r['binaries']):
  print('STF_NATIVE_READY unchanged',flush=True);raise SystemExit(0)
except (FileNotFoundError,KeyError,ValueError):pass
import pathlib,shutil,re,urllib.request,tarfile,io,json,hashlib,subprocess
root=pathlib.Path('/srv/manta/stf-low-power');src=pathlib.Path('/srv/manta/nos3')
root.mkdir(exist_ok=True)
if not (root/'.source-copied').exists():
 shutil.copytree(src,root,dirs_exist_ok=True,symlinks=True,ignore=shutil.ignore_patterns('build','exe','.git','.manta','engineering'))
 (root/'.source-copied').write_text('Copied private existing NOS3 subset; no original mutation.\n')
pins={'fsw/apps/ds':('DS','568b29324ff58b3af287e5138182c817810055f8'),'fsw/apps/to':('CFS_TO','666a8d17c87ac4f5dae1719dc218f9146468d062'),'fsw/apps/lc':('LC','5daef363c95d71c1ff3c5e9dcd4dddab560e8b39'),'fsw/apps/sc':('SC','4ff66c2b7f9d02eb7806bb3d085e1cfeb1f4ae72'),'components/generic_eps':('generic_eps','1aad19930ada314091d5be0b75bfd4379a39765d'),'components/mgr':('mgr','e4f56752df4549ffe074b79d768374f51099357b'),'components/sample':('sample','9d1a76dc391fefe7a42314052c1f10fa527f526b'),'components/arducam':('arducam','d123f505885e8796e645c21550422340804c911d'),'components/generic_radio':('generic_radio','a2effa73715ab4fe2fdc41e549ae2dca81214d98'),'components/generic_thruster':('generic_thruster','0ff68370fbac15291e67316ac60aff3a89115f70'),'components/syn':('syn','721c8d1756559aa3374a90c3cd2887b52405ee8d')}
receipts=[]
for dest,(repo,commit) in pins.items():
 target=root/dest;marker=target/'.manta-source-pin'
 if marker.exists() and marker.read_text().strip()==commit:continue
 url=f'https://codeload.github.com/nasa-itc/{repo}/tar.gz/{commit}';print('Fetch',url,flush=True)
 data=urllib.request.urlopen(url,timeout=90).read();archive=tarfile.open(fileobj=io.BytesIO(data),mode='r:gz');members=archive.getmembers();prefix=pathlib.PurePosixPath(members[0].name).parts[0]
 target.mkdir(parents=True,exist_ok=True)
 for m in members:
  rel=pathlib.PurePosixPath(m.name)
  if rel.is_absolute() or '..' in rel.parts or m.issym() or m.islnk():raise RuntimeError('Unsafe archive')
  parts=rel.parts[1:]
  if not parts:continue
  out=target.joinpath(*parts)
  if m.isdir():out.mkdir(parents=True,exist_ok=True)
  elif m.isfile():out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(archive.extractfile(m).read())
 marker.write_text(commit+'\n');receipts.append({'path':dest,'repository':repo,'commit':commit,'archiveSha256':hashlib.sha256(data).hexdigest()})
(root/'source-pins.json').write_text(json.dumps(receipts,indent=2))
build=root/'cfg/build';build.mkdir(parents=True,exist_ok=True)
for name in ['InOut','nos3_defs','sims']:shutil.copytree(root/'cfg'/name,build/name,dirs_exist_ok=True)
defs=build/'nos3_defs';target=(defs/'targets.cmake').read_text();target=re.sub(r'list\(APPEND MISSION_GLOBAL_APPLIST\b.*?\n\)', 'list(APPEND MISSION_GLOBAL_APPLIST\n hwlib ci_lab to_lab sch lc sc\n generic_adcs/fsw/cfs generic_star_tracker/fsw/cfs\n generic_eps/fsw/cfs mgr/fsw/cfs sample/fsw/cfs\n)',target,count=1,flags=re.S)
target+='\n# Header-only dependencies for original mission command tables.\n'
for component in [*(root/'components').iterdir(),*(root/'fsw/apps').iterdir()]:
 for sub in ['fsw/cfs/inc','fsw/cfs/src','fsw/cfs/mission_inc','fsw/cfs/platform_inc','fsw/shared','fsw/inc','fsw/src','fsw/public_inc','fsw/platform_inc','fsw/mission_inc']:
  d=component/sub
  if d.exists():target+=f'list(APPEND APPLICATION_PLATFORM_INC_LIST "{d}")\n'
(defs/'targets.cmake').write_text(target)
startup='''CFE_LIB, hwlib, hwlib_Init, HW_LIB, 0, 0, 0x0, 0;
CFE_APP, sch, SCH_AppMain, SCH, 40, 16384, 0x0, 0;
CFE_APP, ci_lab, CI_Lab_AppMain, CI_LAB_APP, 80, 16384, 0x0, 0;
CFE_APP, to_lab, TO_LAB_AppMain, TO_LAB_APP, 81, 32768, 0x0, 0;
CFE_APP, lc, LC_AppMain, LC, 53, 32768, 0x0, 0;
CFE_APP, sc, SC_AppMain, SC, 54, 32768, 0x0, 0;
CFE_APP, generic_adcs, ADCS_AppMain, ADCS, 60, 32768, 0x0, 0;
CFE_APP, generic_st, ST_AppMain, ST, 72, 32768, 0x0, 0;
CFE_APP, generic_eps, EPS_AppMain, EPS, 63, 32768, 0x0, 0;
CFE_APP, mgr, MGR_AppMain, MGR, 75, 32768, 0x0, 0;
CFE_APP, sample, SAMPLE_AppMain, SAMPLE, 71, 32768, 0x0, 0;
!
'''
(defs/'cpu1_cfe_es_startup.scr').write_text(startup)
# Preserve original scheduler mission table so LC/SC and component requests execute.
# Add all relevant software-bus messages to the original TO_LAB subscription table.
to=(root/'fsw/apps/to_lab/fsw/tables/to_lab_sub.c').read_text()
messages=[]
for key in ['GENERIC_EPS_HK_TLM_MID','GENERIC_EPS_DEVICE_TLM_MID','MGR_HK_TLM_MID','LC_HK_TLM_MID','LC_WP_TLM_MID','LC_AP_TLM_MID','SC_HK_TLM_MID','SAMPLE_HK_TLM_MID']:
 for file in [*(root/'components').glob('*/fsw/cfs/platform_inc/*msgids.h'),*(root/'fsw/apps').glob('*/fsw/inc/*msgids.h')]:
  m=re.search(r'^#define\s+'+key+r'\s+([^\n]+)',file.read_text(),re.M)
  if m:messages.append((key,m.group(1).strip()))
print('Messages',messages,flush=True)
extra=''.join('{CFE_SB_MSGID_WRAP_VALUE('+val+'), {0, 0}, 32},\n                                      ' for key,val in messages)
to=to.replace('/* CFE_SB_MSGID_RESERVED entry',extra+'/* CFE_SB_MSGID_RESERVED entry');(defs/'tables/to_lab_sub.c').write_text(to)
print('PREPARED',root,flush=True)

import pathlib,re,shutil
root=pathlib.Path('/srv/manta/stf-low-power');build=root/'cfg/build';defs=build/'nos3_defs'
p=root/'sims/CMakeLists.txt';text=p.read_text();text=text.replace('IF(EXISTS ${_FILE}/sim/CMakeLists.txt)', 'IF(EXISTS ${_FILE}/sim/CMakeLists.txt AND (_FILE MATCHES "/generic_eps$" OR _FILE MATCHES "/generic_star_tracker$" OR _FILE MATCHES "/sample$"))');p.write_text(text)
xml=(build/'sims/nos3-simulator.xml').read_text()
def select(m):
 block=m.group(0);name=re.search(r'<name>([^<]+)</name>',block).group(1);active='true' if name in ['time','truth42sim','generic-star-tracker-sim','generic-eps-sim','sample-sim','udp-terminal'] else 'false';return re.sub(r'<active>[^<]+</active>',f'<active>{active}</active>',block,count=1)
xml=re.sub(r'<simulator>.*?</simulator>',select,xml,flags=re.S)
xml=re.sub(r'tcp://[^:<\s]+:(1200[01])',r'tcp://127.0.0.1:\1',xml);xml=re.sub(r'<(hostname|cosmos-hostname)>[^<]+</\1>',lambda m:f'<{m.group(1)}>127.0.0.1</{m.group(1)}>',xml)
# NASA native terminal on a private guest UDP port drives production command bus.
terminal=(root/'sims/sim_terminal/cfg/nos3-terminal-simulator.xml').read_text();terminal=re.search(r'<simulator>\s*<name>udp-terminal</name>.*?</simulator>',terminal,re.S).group(0).replace('sample-sim-command-node','eps-command').replace('5556','5557')
xml=xml if '<name>udp-terminal</name>' in xml else (xml.replace('</simulators>',terminal+'\n</simulators>') if '</simulators>' in xml else xml.replace('</nos3-simulator>',terminal+'\n</nos3-simulator>'))
if '<name>udp-terminal</name>' not in xml:
 at=xml.rfind('</');xml=xml[:at]+terminal+'\n'+xml[at:]
(build/'sims/nos3-simulator.xml').write_text(xml)
f42=root/'42run';f42.mkdir(exist_ok=True)
for name in ['42','World','Model']:
 p=f42/name
 if not p.exists():p.symlink_to(pathlib.Path('/srv/manta/42')/name)
shutil.copytree(root/'cfg/InOut',f42/'InOut',dirs_exist_ok=True)
p=f42/'InOut/Inp_Sim.txt';text=(root/'cfg/InOut/Inp_Sim_STF1.txt').read_text();text=re.sub(r'^TRUE\s+!\s+Graphics Front End\?', 'FALSE                           !  Graphics Front End?',text,flags=re.M);text=re.sub(r'^604800\.0\s+0\.01','180.0  0.01',text,flags=re.M);p.write_text(text)
p=f42/'InOut/Inp_IPC.txt';lines=p.read_text().splitlines(True);enabled=False
for i,line in enumerate(lines):
 if line.startswith('***'):enabled=any(s in line for s in ['Star Tracker IPC','Truth data','EPS IPC','Sample IPC'])
 if 'IPC Mode (' in line and not enabled:lines[i]='OFF                                     ! IPC Mode (OFF,TX,RX,TXRX,ACS,WRITEFILE,READFILE)\n'
p.write_text(''.join(lines));p=f42/'InOut/Inp_NOS3.txt';p.write_text(p.read_text().replace('nos-engine-server','127.0.0.1'))
print('Simulation config ready',flush=True)


# The case exercises actual LC/SC/EPS logic through a CI test scheduler, not an unqualified full mission scheduler.
for name in ['sch_def_msgtbl.c','sch_def_schtbl.c']:
 shutil.copyfile(root/'fsw/apps/sch/fsw/tables'/name,defs/'tables'/name)
if (defs/'tables/sc_rts015.c').exists() and not (root/'cfg/nos3_defs/tables/sc_rts015.c').exists():(defs/'tables/sc_rts015.c').unlink()
env=dict(__import__('os').environ,CFS_APP_PATH='../components',MISSION_DEFS='../cfg/build/',MISSIONCONFIG='../cfg/build/nos3')
commands=[['cmake','-S','fsw/cfe','-B','fsw/build','-DCMAKE_INSTALL_PREFIX='+str(root/'fsw/build/exe'),'-DCMAKE_BUILD_TYPE=Debug'],['cmake','--build','fsw/build','--target','mission-install','--parallel','4'],['cmake','-S','sims','-B','sims/build','-DCMAKE_INSTALL_PREFIX='+str(root/'sims/build')],['cmake','--build','sims/build','--target','install','--parallel','4']]
for index,command in enumerate(commands):
 with (root/f'prepare-{index}.log').open('w') as log:
  result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=360)
 if result.returncode:raise RuntimeError('Native STF preparation failed: '+str(root/f'prepare-{index}.log'))
binaries=[root/'fsw/build/exe/cpu1/core-cpu1',root/'fsw/build/exe/cpu1/cf/lc.so',root/'fsw/build/exe/cpu1/cf/sc.so',root/'fsw/build/exe/cpu1/cf/generic_eps.so',root/'fsw/build/exe/cpu1/cf/mgr.so',root/'sims/build/bin/nos3-single-simulator',root/'sims/build/lib/libgeneric_eps_sim.so',pathlib.Path('/srv/manta/42/42')]
receipt={'schema':'manta-stf-low-power-ready-v1','recipeVersion':1,'prepareRecipeSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'ready':True,'tool':{'id':'nos3-stf','version':'NOS3 STF 5a3bdee6 / LC 5daef363 / SC 4ff66c2b / EPS 1aad1993'},'binaries':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in binaries]}
(root/'ready.json').write_text(json.dumps(receipt,indent=2))
print('STF_NATIVE_READY',flush=True)
