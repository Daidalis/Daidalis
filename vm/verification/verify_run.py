#!/usr/bin/env python3
"""Manta worker entrypoint: verify an executed live run, fail closed, save evidence."""
import argparse
import hashlib
import json
from pathlib import Path
from verify_startracker import rows,verify,dcm,mm,angle,q_angle
from verify_telemetry import verify as verify_udp
from configure_startracker_case import axis_rotation

FRAME_FAILURES={'sensor_to_body_rotation_applied_once_in_correct_order',
                'gnc_output_matches_sensor_derived_body_attitude','UDP_GNC_matches_sensor_frame_model'}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--run-dir',type=Path,required=True)
    p.add_argument('--expect',choices=['fixed','baseline-defect','invalid'],default='fixed')
    p.add_argument('--sensor-sign',choices=['normal','negate'],default='normal')
    p.add_argument('--sensor-bias-deg',type=float,default=0.)
    p.add_argument('--allow-identity-mount',action='store_true')
    p.add_argument('--min-samples',default=10,type=int)
    args=p.parse_args(); root=args.run_dir.resolve()
    simfile=root/'startracker.log'; fswfile=root/'fsw.log'; truthfile=root/'fortytwo.log'; packetfile=root/'packets.jsonl'
    required=[simfile,fswfile,truthfile,packetfile,root/'run.json']
    missing=[str(p) for p in required if not p.is_file()]
    if missing:
        result={'schema':'manta.nos3.full-linux-verification.v1','passed':False,'status':'missing_evidence','missing':missing}
    else:
        sim=rows(simfile); fsw=rows(fswfile); truth=rows(truthfile)
        probe=verify(sim,fsw,truth,not args.allow_identity_mount,args.min_samples,expect_invalid=args.expect=='invalid')
        udp=verify_udp(packetfile,fswfile,args.min_samples,expect_invalid=args.expect=='invalid')
        providers=[r for r in sim if r.get('stage')=='uart_simulator']
        sign=-1 if args.sensor_sign=='negate' else 1
        sign_ok=bool(providers) and all(r.get('sensor_sign')==sign and
                    (not r['valid'] or sign*sum(a*b for a,b in zip(r['provider_qsn'],r['source_qsn']))>0) for r in providers)
        bias_errors=[angle(dcm(r['provider_qsn']),mm(axis_rotation(1,args.sensor_bias_deg),dcm(r['source_qsn'])))
                     for r in providers if r['valid']]
        bias_ok=bool(providers) and all(abs(r.get('sensor_bias_deg',0.)-args.sensor_bias_deg)<1e-12 for r in providers) and (
            args.expect=='invalid' or bool(bias_errors) and max(bias_errors)<1e-5)
        allchecks=probe['checks']+udp['checks']+[{'name':'explicit_sensor_sign_injection_matches_source','passed':sign_ok,'expected_sign':sign}]
        allchecks.append({'name':'explicit_sensor_bias_matches_independent_rotation','passed':bias_ok,
                          'expected_bias_deg':args.sensor_bias_deg,'max_rotation_error_deg':max(bias_errors,default=None)})
        separations=[]
        truth_rows=[r for r in truth if r.get('stage')=='truth42_sensor' and r.get('valid')]
        source_truth_matches=[]
        source_body_errors=[]
        mounting_inverse_errors=[]
        if args.expect!='invalid':
            mount_rows=[r for r in fsw if r.get('stage')=='adcs_update' and r.get('di_valid')]
            mount=mount_rows[0]['mount_qbs'] if mount_rows else None
            for provider in [r for r in providers if r['valid']]:
                matching=[r for r in truth_rows if q_angle(provider['source_qsn'],r['qsn'])<1e-5]
                if not matching or mount is None: continue
                reference=matching[0]
                source_truth_matches.append(reference)
                source_body_errors.append(angle(mm(dcm(mount),dcm(provider['source_qsn'])),dcm(reference['body_qbn'])))
                mounting_inverse_errors.append(angle(mm(dcm(mount),mm(dcm(reference['mount_qsb']),dcm(reference['node_qb']))),[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]]))
            allchecks.append({'name':'actual_42_sensor_stream_matches_pre_fault_provider',
                'passed':len(source_truth_matches)>=args.min_samples,'samples':len(source_truth_matches)})
            allchecks.append({'name':'ADCS_mount_is_inverse_of_actual_42_sensor_and_node_mount',
                'passed':bool(mounting_inverse_errors) and max(mounting_inverse_errors)<1e-5,
                'max_rotation_error_deg':max(mounting_inverse_errors,default=None)})
            allchecks.append({'name':'unbiased_sensor_geometry_recovers_separate_42_body_truth',
                'passed':bool(source_body_errors) and max(source_body_errors)<=0.02,
                'max_rotation_error_deg':max(source_body_errors,default=None)})
        if abs(args.sensor_bias_deg)>0:
            for update in [r for r in fsw if r.get('stage')=='adcs_update' and r.get('di_valid')]:
                matching=[r for r in providers if r['valid'] and max(abs(a-(word-32768.)/32767.) for a,word in zip(update['raw_qsn'],r['words']))<1e-12]
                if not matching: continue
                truth_matching=[r for r in truth_rows if q_angle(matching[0]['source_qsn'],r['qsn'])<1e-5]
                if not truth_matching: continue
                separations.append(angle(dcm(update['gnc_qbn']),dcm(truth_matching[0]['body_qbn'])))
            allchecks.append({'name':'gnc_follows_biased_sensor_instead_of_unbiased_body_truth',
                'passed':len(separations)>=args.min_samples and max(abs(x-abs(args.sensor_bias_deg)) for x in separations)<=0.02,
                'samples':len(separations),'expected_separation_deg':abs(args.sensor_bias_deg),
                'minimum_observed_separation_deg':min(separations,default=None),'maximum_observed_separation_deg':max(separations,default=None),
                'scope':'Counterfactual fault is inserted only into sensor measurement before UART; 42 dynamics remain unchanged.'})
            config=json.loads((root/'case.json').read_text()) if (root/'case.json').is_file() else {}
            truth_body=[r['body_qbn'] for r in truth if r.get('stage')=='truth42_sensor' and r.get('valid')]
            truth_errors=[q_angle(q,config['initial_body_qbn']) for q in truth_body] if config.get('initial_body_qbn') else []
            allchecks.append({'name':'separate_42_body_truth_remains_at_unbiased_configured_attitude',
                'passed':len(truth_errors)>=args.min_samples and max(truth_errors)<=0.02,
                'max_rotation_error_deg':max(truth_errors,default=None),'samples':len(truth_errors)})
        failed=[c['name'] for c in allchecks if not c['passed']]
        reproduced=(set(failed)&FRAME_FAILURES)==FRAME_FAILURES and not(set(failed)-FRAME_FAILURES)
        accepted=reproduced if args.expect=='baseline-defect' else not failed
        result={'schema':'manta.nos3.full-linux-verification.v1','passed':accepted,
                'status':'defect_reproduced' if args.expect=='baseline-defect' and reproduced else ('verified' if accepted else 'verification_failed'),
                'engineering_requirement_satisfied':args.expect!='baseline-defect' and accepted,
                'expectation':args.expect,'sensor_sign':args.sensor_sign,'sensor_bias_deg':args.sensor_bias_deg,'failed_checks':failed,
                'sensor_separation_deg':{'min':min(separations,default=None),'max':max(separations,default=None)},
                'checks':allchecks,'production_path':probe,'udp_telemetry':udp,
                'execution_receipt':json.loads((root/'run.json').read_text()),
                'evidence':[{'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in required],
                'scope_limitations':['This selected live NOS3/cFS/42 star-tracker chain is not an all-devices mission or hardware qualification.',
                                     'Live q/-q coverage requires both normal and negated signed runs.',
                                     'Production ADCS has no freshness timeout for this message; stale data handling remains unverified.']}
    target=root/'verification.json'
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'status':result['status'],'output':str(target),'failed_checks':result.get('failed_checks',[])}))
    raise SystemExit(0 if result['passed'] else 1)

if __name__=='__main__': main()
