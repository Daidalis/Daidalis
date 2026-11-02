#!/usr/bin/env python3
"""Fixed Manta worker entrypoint for a real, isolated Linux NOS3 campaign.

The guest must have been provisioned and the pinned native source copy prepared.
This command changes only /srv/manta source/build/runtime copies and requested
evidence output. It never changes a macOS/global application configuration.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

CASES=[('baseline','baseline','normal','noncommuting','baseline-defect',0.),
       ('fixed','fixed','normal','noncommuting','fixed',0.),
       ('negative-sign','fixed','negate','noncommuting','fixed',0.),
       ('invalid','fixed','normal','invalid','invalid',0.),
       ('sensor-bias','fixed','normal','noncommuting','fixed',2.)]

class CampaignInterrupted(RuntimeError):
    pass

def install_signal_handlers():
    def interrupt(signum,frame):
        raise CampaignInterrupted('Campaign interrupted by signal '+str(signum))
    signal.signal(signal.SIGTERM,interrupt)
    signal.signal(signal.SIGINT,interrupt)

def compact_evidence(folder,report):
    summary=json.loads(json.dumps(report))
    decoded=summary.get('udp_telemetry',{}).pop('decoded_packets',[])
    summary['udp_telemetry']['decoded_packet_count']=len(decoded)
    summary['evidence_selection']='Summary and selected actual raw packet samples; complete raw streams remain in guest with SHA manifests.'
    (folder/'verification-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    groups={}
    for line in (folder/'packets.jsonl').read_text().splitlines():
        row=json.loads(line)
        if row.get('source')!='telemetry' or row.get('mid') not in ['0x935','0x936','0x940','0x941','0x942','0x943']:
            continue
        groups.setdefault(row['mid'],[]).append(row)
    selected=[]
    for values in groups.values():
        selected.extend(values if len(values)<=8 else values[:4]+values[-4:])
    (folder/'telemetry-samples.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in selected))

def command(argv,log,timeout=1200,allow_failure=False):
    began=time.monotonic()
    with log.open('wb') as out:
        proc=subprocess.Popen(list(map(str,argv)),stdout=out,stderr=subprocess.STDOUT)
        try:
            returncode=proc.wait(timeout=timeout)
        except BaseException:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait(timeout=2)
            raise
    record={'argv':list(map(str,argv)),'exitCode':returncode,'elapsedSeconds':round(time.monotonic()-began,3),'log':log.name}
    print(json.dumps({'event':'command_completed',**record}),flush=True)
    if returncode and not allow_failure:
        tail=log.read_text(errors='replace')[-2500:]
        raise RuntimeError(f'Command failed ({returncode}): {argv[0]}: {tail}')
    return record

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--duration',type=float,default=20.)
    p.add_argument('--reuse-campaign',type=Path,help='Verify and package existing real campaign case directories without executing again')
    args=p.parse_args()
    out=args.out.resolve()
    if os.uname().sysname!='Linux':
        raise SystemExit('This entrypoint must execute inside the dedicated Linux guest')
    if str(out) in ['/','/srv','/srv/manta']:
        raise SystemExit('Output must be a dedicated job directory')
    if not 10<=args.duration<=120:
        raise SystemExit('Duration must be within 10..120 seconds')
    out.mkdir(parents=True,exist_ok=True)
    if (out/'verification.json').exists():
        raise SystemExit('Existing verification receipt must not be overwritten')
    here=Path(__file__).resolve().parent
    shutil.copyfile(here/'engineering-fix.json',out/'engineering-fix.json')
    plan=here.parent/'nos3-plan'
    work=Path('/srv/manta/nos3'); fortytwo=Path('/srv/manta/42')
    job=Path('/srv/manta/runs')/('campaign-'+uuid.uuid4().hex)
    case_reports={}; operations=[]; began=time.monotonic(); failure=None
    lock=None; lock_acquired=False; restored={'status':'not_attempted'}
    try:
        install_signal_handlers()
        lock=Path('/srv/manta/verification.lock').open('a')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        lock_acquired=True
        if not(work/'.manta-isolated-nos3').is_file() or not(fortytwo/'.manta-isolated-42').is_file():
            raise RuntimeError('Pinned isolated guest sources are not prepared; native provisioning is required')
        if not args.reuse_campaign:
            job.mkdir(parents=True)
            operations.append(command([sys.executable,'-B',here/'instrument_truth42.py','--source',fortytwo],out/'instrument-42.log'))
        for name,mode,sign,scenario,expect,bias in CASES:
            print(json.dumps({'event':'case_started','case':name,'expectation':expect}),flush=True)
            if args.reuse_campaign:
                run=args.reuse_campaign.resolve()/name
                if not run.is_dir(): raise RuntimeError(f'Missing reusable live case: {run}')
            else:
                run=job/name
                operations.append(command([sys.executable,'-B',here/'instrument_startracker.py','--source',work,'--mode',mode,'--sensor-sign',sign,'--sensor-bias-deg',bias],out/f'{name}-instrument.log'))
                operations.append(command(['/bin/bash',plan/'build_native.sh',work],out/f'{name}-build.log'))
                operations.append(command([sys.executable,'-B',here/'configure_startracker_case.py','--source',work,
                    '--inout',fortytwo/'NOS3InOut','--di-file',work/'fsw/build/exe/cpu1/cf/Inp_DI.txt','--case',scenario],out/f'{name}-configure.log'))
                operations.append(command([sys.executable,'-B',plan/'run_native.py','--work',work,'--output',run,'--duration',args.duration],out/f'{name}-execution.log',timeout=180))
                for source,target in [(work/f'manta-startracker-{mode}.json','source-manifest.json'),
                                      (work/f'manta-startracker-{mode}.patch','source.patch'),
                                      (work/f'manta-case-{scenario}.json','case.json'),
                                      (fortytwo/'manta-truth42-probe.json','truth-observer-manifest.json')]:
                    shutil.copyfile(source,run/target)
                for path,label in [(fortytwo/'NOS3InOut/SC_NOS3.txt','SC_NOS3.txt'),
                                   (work/'fsw/build/exe/cpu1/cf/Inp_DI.txt','Inp_DI.txt'),
                                   (fortytwo/'NOS3InOut/Inp_Sim.txt','Inp_Sim.txt'),
                                   (fortytwo/'NOS3InOut/Inp_IPC.txt','Inp_IPC.txt')]:
                    shutil.copyfile(path,run/label)
                binary_paths=[fortytwo/'42',work/'fsw/build/exe/cpu1/core-cpu1',work/'sims/build/bin/nos3-single-simulator']
                binary_paths.extend(path for folder in [work/'fsw/build/exe/cpu1/cf',work/'sims/build/lib']
                                    for path in folder.glob('*') if path.is_file() and
                                    any(name in path.name for name in ['generic_adcs','generic_st','generic_star_tracker','truth_42']))
                binaries=[{'path':str(path),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
                          for path in binary_paths if path.is_file()]
                (run/'binary-manifest.json').write_text(json.dumps({'binaries':binaries,
                    'verificationScripts':[{'name':script.name,'sha256':hashlib.sha256(script.read_bytes()).hexdigest()} for script in here.glob('*.py')]},indent=2)+'\n')
            shutil.copyfile(here/'pinned-source-hashes.json',run/'pinned-source-hashes.json')
            operations.append(command([sys.executable,'-B',here/'verify_run.py','--run-dir',run,'--expect',expect,'--sensor-sign',sign,'--sensor-bias-deg',bias],out/f'{name}-verification.log',timeout=120,allow_failure=True))
            destination=out/name
            shutil.copytree(run,destination)
            report=json.loads((destination/'verification.json').read_text())
            compact_evidence(destination,report)
            case_reports[name]=report
    except Exception as exc:
        failure=str(exc)
    finally:
        # One controlled interruption enters cleanup. Repeated requests cannot
        # interrupt restoration; the outer worker still has a bounded kill grace.
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        signal.signal(signal.SIGINT,signal.SIG_IGN)
        if lock_acquired and not args.reuse_campaign:
            try:
                operations.append(command([sys.executable,'-B',here/'instrument_startracker.py','--source',work,
                    '--mode','fixed','--sensor-sign','normal','--sensor-bias-deg','0'],out/'restore-instrument.log'))
                operations.append(command(['/bin/bash',plan/'build_native.sh',work],out/'restore-build.log'))
                operations.append(command([sys.executable,'-B',here/'configure_startracker_case.py','--source',work,
                    '--inout',fortytwo/'NOS3InOut','--di-file',work/'fsw/build/exe/cpu1/cf/Inp_DI.txt',
                    '--case','noncommuting'],out/'restore-configure.log'))
                restored={'status':'restored','mode':'fixed','sensorSign':'normal','sensorBiasDeg':0,
                    'sourceManifestSha256':hashlib.sha256((work/'manta-startracker-fixed.json').read_bytes()).hexdigest(),
                    'binaryReceiptSha256':hashlib.sha256(Path('/srv/manta/receipts/binaries.sha256').read_bytes()).hexdigest()}
            except Exception as exc:
                restored={'status':'restore_failed','error':str(exc)}
                failure=(failure+'; ' if failure else '')+'Runtime restoration failed: '+str(exc)
        elif args.reuse_campaign:
            restored={'status':'not_modified_reused_evidence'}
        if lock is not None:
            lock.close()
    checks=[]
    for name,mode,sign,scenario,expect,bias in CASES:
        report=case_reports.get(name)
        checks.append({'id':name,'name':{'baseline':'Original production defect reproduced by live noncommuting mounting',
            'fixed':'Fixed live sensor → NOS Engine UART → cFS SB → ADCS → GNC chain satisfies model',
            'negative-sign':'Physically equivalent negative sensor quaternion traverses same live chain',
            'invalid':'Invalid sensor measurement clears actual AD/GNC validity',
            'sensor-bias':'GNC follows the independently biased sensor while 42 body truth remains unchanged'}[name],
            'passed':bool(report and report.get('passed')),'status':report.get('status') if report else 'not_completed',
            'report':name+'/verification.json' if report else None})
        checks[-1]['criterion']=checks[-1]['name']
    checks.append({'id':'runtime-restored','criterion':'Private engineering runtime restored to fixed, normal-sign, zero-bias configuration',
                   'passed':restored['status'] in ['restored','not_modified_reused_evidence'],'status':restored['status']})
    fixed=case_reports.get('fixed',{}); negative=case_reports.get('negative-sign',{})
    def max_error(report,key):
        values=[c.get('max_rotation_error_deg') for c in report.get('checks',[]) if c['name']==key]
        return values[0] if values else None
    files=[path for path in out.rglob('*') if path.is_file() and path!=out/'verification.json']
    manifest=[{'path':str(path.relative_to(out)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size} for path in files]
    selected_names=['telemetry-samples.jsonl','verification-summary.json','case.json','source-manifest.json','binary-manifest.json','pinned-source-hashes.json','engineering-fix.json']
    selected=[m for m in manifest if Path(m['path']).name in selected_names]
    if any(m['bytes']>1000000 for m in selected) or sum(m['bytes'] for m in selected)>1700000:
        failure='Compact telemetry evidence exceeds the worker transfer budget; full evidence remains in guest.'
    complete=not failure and len(case_reports)==len(CASES) and all(c['passed'] for c in checks)
    def chain_executed(report):
        samples=report.get('production_path',{}).get('samples',{})
        udp=report.get('udp_telemetry',{}).get('packet_counts',{})
        return (report.get('execution_receipt',{}).get('status')=='executed' and
                samples.get('uart_provider',0)>0 and samples.get('sb_ingest',0)>0 and
                samples.get('adac_valid',0)+samples.get('adac_invalid',0)>0 and
                all(udp.get(name,0)>0 for name in ['startracker','di','ad','gnc']))
    chains={name:chain_executed(report) for name,report in case_reports.items()}
    result={'schema':'manta-nos3-verification-v1','scope':'integration','fullNos3Simulation':any(chains.values()),
            'fullMissionAllDevices':False,'passed':complete,'status':'verified' if complete else 'failed',
            'description':'Native Linux '+os.uname().machine+' NOS3 selected star-tracker / cFS / 42 live simulation campaign',
            'checks':checks,'error':failure,'elapsedSeconds':round(time.monotonic()-began,3),
            'metrics':{'fixedAdcsRotationErrorDeg':max_error(fixed,'sensor_to_body_rotation_applied_once_in_correct_order'),
                'fixedGncRotationErrorDeg':max_error(fixed,'gnc_output_matches_sensor_derived_body_attitude'),
                'negativeSignGncRotationErrorDeg':max_error(negative,'gnc_output_matches_sensor_derived_body_attitude'),
                'negativeControls':{'originalDoubleMountDefect':bool(case_reports.get('baseline',{}).get('passed')),
                                    'quaternionSign':bool(negative.get('passed')),
                                    'invalidMeasurement':bool(case_reports.get('invalid',{}).get('passed')),
                                    'sensorTruthSeparation':bool(case_reports.get('sensor-bias',{}).get('passed'))},
                'sensorTruthSeparationDeg':case_reports.get('sensor-bias',{}).get('sensor_separation_deg'),
                'faultBounds':{'rotationToleranceDeg':0.02,'uartQuantizationComponentBound':1/32767.,
                               'measurementFreshnessTimeout':'not_implemented_in_upstream_tested_path'}},
            'caseChainExecuted':chains,'runtimeRestore':restored,
            'pending':['Physical sensor / hardware-in-the-loop validation','Hard real-time scheduling and timing qualification',
                       'All-device full-mission scenario coverage','Stale measurement timeout behavior'],
            'telemetryFiles':[m['path'] for m in selected],
            'telemetryTransferBytes':sum(m['bytes'] for m in selected),
            'artifacts':manifest,'operations':operations,
            'isolation':{'hostGlobalConfigurationChanged':False,'guestRoot':'/srv/manta','originalProjectModified':False},
            'caseReports':{name:name+'/verification.json' for name in case_reports}}
    (out/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'event':'campaign_completed','passed':complete,'output':str(out/'verification.json'),'error':failure}),flush=True)
    raise SystemExit(0 if complete else 1)

if __name__=='__main__': main()
