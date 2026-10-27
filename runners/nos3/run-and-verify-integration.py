#!/usr/bin/env python3
"""Dedicated disposable Linux worker only; actual NOS3/42/cFS/COSMOS smoke.
Requires a prepared NOS3 deployment and explicit image-lock JSON. It does not
install dependencies or pull images. Upstream scripts may mutate containers;
never run this on a developer's Docker daemon or general purpose machine.
"""
import argparse,hashlib,json,pathlib,platform,re,subprocess,sys,time
p=argparse.ArgumentParser();p.add_argument('--dedicated-disposable-worker',action='store_true',required=True);p.add_argument('--image-lock',required=True);a=p.parse_args()
if platform.system()!='Linux':sys.exit('Dedicated Linux worker required')
root=pathlib.Path.cwd();out=root/'manta-verification';out.mkdir(exist_ok=True)
def run(argv,timeout=180):return subprocess.run(argv,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
lock=json.loads(pathlib.Path(a.image_lock).read_text());required=['ivvitc/nos3-64:20260619','ballaerospace/cosmos:4.5.0']
for image in required:
    expected=lock.get(image)
    if not isinstance(expected,str) or not re.fullmatch('sha256:[a-f0-9]{64}',expected):sys.exit('Explicit immutable image ID required for '+image)
    inspected=run(['docker','image','inspect','--format','{{.Id}}',image],10)
    if inspected.returncode or inspected.stdout.strip()!=expected:sys.exit('Preloaded image missing or mismatched; no image will be pulled: '+image)
# No unrelated containers/networks may exist. The upstream deployment uses fixed names.
existing=run(['docker','ps','-aq'],10)
if existing.returncode or existing.stdout.strip():sys.exit('Worker Docker daemon must be dedicated and empty before this run')
containers=['cosmos-openc3-operator-1','sc01-fortytwo','sc01_nos_fsw','sc01-truth42sim']
checks=[];telemetry=[];errors=[]
try:
    launch=run(['/bin/bash','scripts/ci_launch.sh'],300);(out/'launch.log').write_text(launch.stdout)
    if launch.returncode:raise RuntimeError('Upstream NOS3 launch failed; inspect launch.log')
    for name in containers:
        state=run(['docker','inspect','--format','{{.State.Running}}',name],10)
        checks.append({'id':'RUNNING-'+name,'criterion':'Actual integration process/container is running: '+name,'passed':state.returncode==0 and state.stdout.strip()=='true'})
    # Execute upstream test without the original '-it' option so a headless worker works.
    live=run(['docker','exec','cosmos-openc3-operator-1','ruby','/scripts/gsw/system_test.rb'],120)
    (out/'sample-live-telemetry.log').write_text(live.stdout);telemetry.append('manta-verification/sample-live-telemetry.log')
    counts=re.findall(r'Inital Command Count:\s*(\d+)',live.stdout);errors_found=re.findall(r'Initial Error Count:\s*(\d+)',live.stdout);device_errors=re.findall(r'Inital Device Error Count:\s*(\d+)',live.stdout)
    passed=live.returncode==0 and 'SAMPLE TEST CASE COMPLETED SUCCESSFULLY!' in live.stdout and len(counts)>=2 and int(counts[-1])>int(counts[0]) and len(errors_found)>=2 and errors_found[-1]==errors_found[0] and len(device_errors)>=2 and device_errors[-1]==device_errors[0]
    checks.append({'id':'LIVE-CMD-TELEMETRY','criterion':'Upstream SAMPLE NOOP increments observed live command counter without incrementing command/device error counters','passed':passed})
    for name in containers:
        log=run(['docker','logs','--tail','300',name],10);name_file=name.replace('/','_')+'.log';(out/name_file).write_text(log.stdout[:500000]);telemetry.append('manta-verification/'+name_file)
except Exception as exc:errors.append(str(exc));checks.append({'id':'EXECUTION','criterion':'NOS3 integration execution completes without launcher/test errors','passed':False})
finally:
    # Only terminate container IDs created by this run; do not invoke upstream broad prune.
    all_ids=run(['docker','ps','-aq'],10)
    if all_ids.returncode==0:
        ids=[x for x in all_ids.stdout.splitlines() if re.fullmatch('[a-f0-9]{12,64}',x)]
        if ids:run(['docker','rm','-f',*ids],30)
report={'schema':'manta-nos3-verification-v1','scope':'integration','fullNos3Simulation':len(checks)>=5 and all(x['passed'] for x in checks if x['id'].startswith('RUNNING-')),'hardwareValidation':False,'passed':bool(checks) and all(x['passed'] for x in checks),'checks':checks,'telemetryFiles':telemetry,'imageLock':lock,'errors':errors,'pendingRequirements':[{'id':'R-SENSOR-SEPARATION','status':'not-tested','reason':'SAMPLE command/telemetry smoke does not verify star-tracker frame behavior.'}],'limitations':['This is an actual integration smoke, not proof of all mission requirements or NOS3 issue #351.','Star-tracker frame convention, fault behavior and hardware require further dedicated scenarios.']}
(out/'integration.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));sys.exit(0 if report['passed'] else 1)
