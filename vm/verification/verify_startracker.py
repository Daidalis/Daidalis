#!/usr/bin/env python3
"""Independent matrix oracle for observations from live NOS3 production paths."""
import argparse
import hashlib
import json
import math
from pathlib import Path

IDENTITY = [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]]

def mm(a,b):
    return [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

def transpose(a):
    return [list(row) for row in zip(*a)]

def dcm(q):
    if len(q)!=4 or not all(math.isfinite(x) for x in q):
        raise ValueError('Expected four finite quaternion components')
    n=math.sqrt(sum(x*x for x in q))
    if n<1e-12:
        raise ValueError('Zero quaternion is not a rotation')
    x,y,z,w=[x/n for x in q]
    return [[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)],
            [2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)],
            [2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]]

def angle(a,b):
    delta=mm(a,transpose(b))
    cosine=max(-1.,min(1.,(sum(delta[i][i] for i in range(3))-1.)/2.))
    return math.degrees(math.acos(cosine))

def q_angle(a,b):
    return angle(dcm(a),dcm(b))

def rows(path):
    records=[]
    for number,line in enumerate(path.read_text(errors='replace').splitlines(),1):
        if 'MANTA_TRACE ' not in line:
            continue
        text=line.split('MANTA_TRACE ',1)[1]
        try:
            row=json.loads(text)
        except (ValueError,TypeError):
            continue
        row['_line']=number
        records.append(row)
    return records

def verify(sim,fsw,truth=None,require_nonidentity=True,min_samples=10,tolerance=0.02,expect_invalid=False):
    provider=[r for r in sim if r.get('stage')=='uart_simulator']
    ingest=[r for r in fsw if r.get('stage')=='sb_ingest']
    updates=[r for r in fsw if r.get('stage')=='adcs_update' and r.get('sensor_sequence',0)>0]
    checks=[]
    def check(name,ok,**details):
        checks.append({'name':name,'passed':bool(ok),**details})
    check('live_uart_provider_observed',len(provider)>=min_samples,samples=len(provider),minimum=min_samples)
    check('production_cfs_software_bus_ingest_observed',len(ingest)>=min_samples,samples=len(ingest))
    valid=[r for r in updates if r.get('di_valid')]
    invalid=[r for r in updates if not r.get('di_valid')]
    check('production_adac_and_gnc_updates_observed',len(invalid if expect_invalid else valid)>=min_samples,
          samples=len(invalid if expect_invalid else valid),expected_input='invalid' if expect_invalid else 'valid')
    quant_errors=[]
    decoded=[]
    for r in provider:
        q=[(word-32768.)/32767. for word in r['words']]
        decoded.append((q,r['valid']))
        quant_errors.append(max(abs(a-b) for a,b in zip(q,r['provider_qsn'])))
    check('actual_uart_16bit_quantization',bool(quant_errors) and max(quant_errors)<=1/32767.+1e-12,
          max_component_error=max(quant_errors,default=None),limit=1/32767.)
    unmatched=[]
    for r in ingest:
        if not any(v==r['valid'] and max(abs(a-b) for a,b in zip(q,r['raw_qsn']))<1e-12 for q,v in decoded):
            unmatched.append(r['sensor_sequence'])
    check('uart_decoded_measurement_reaches_actual_sb_ingest',bool(ingest) and not unmatched,
          unmatched_sequences=unmatched[:20])
    indexed={r['sensor_sequence']:r for r in ingest}
    linkage=[]
    for r in updates:
        source=indexed.get(r['sensor_sequence'])
        if not source or source['valid']!=r['di_valid'] or any(abs(a-b)>1e-12 for a,b in zip(source['raw_qsn'],r['raw_qsn'])):
            linkage.append(r['sensor_sequence'])
    check('adac_uses_captured_sensor_sample',bool(updates) and not linkage,unmatched_sequences=linkage[:20])
    ad_errors=[]; gnc_errors=[]; sign_errors=[]; wrong_order=[]; mount_angles=[]; body_angles=[]
    for r in valid:
        csn=dcm(r['raw_qsn']); cbs=dcm(r['mount_qbs']); expected=mm(cbs,csn)
        ad_errors.append(angle(dcm(r['ad_qbn']),expected))
        gnc_errors.append(angle(dcm(r['gnc_qbn']),expected))
        sign_errors.append(angle(mm(cbs,dcm([-x for x in r['raw_qsn']])),expected))
        wrong_order.append(angle(mm(csn,cbs),expected))
        mount_angles.append(angle(cbs,IDENTITY)); body_angles.append(angle(expected,IDENTITY))
    if not expect_invalid:
        check('sensor_to_body_rotation_applied_once_in_correct_order',bool(ad_errors) and max(ad_errors)<=tolerance,
              max_rotation_error_deg=max(ad_errors,default=None),tolerance_deg=tolerance)
        check('gnc_output_matches_sensor_derived_body_attitude',bool(gnc_errors) and max(gnc_errors)<=tolerance,
              max_rotation_error_deg=max(gnc_errors,default=None),tolerance_deg=tolerance)
        check('valid_sensor_marks_ad_and_gnc_valid',bool(valid) and all(r['ad_valid']==1 and r['gnc_valid']==1 for r in valid))
        check('q_and_negative_q_oracle_equivalence',bool(sign_errors) and max(sign_errors)<1e-5,
              max_difference_deg=max(sign_errors,default=None),scope='oracle sign invariance; live sign cases tracked separately')
    if require_nonidentity and not expect_invalid:
        check('nonidentity_mount_exercised',bool(mount_angles) and max(mount_angles)>5.,max_angle_deg=max(mount_angles,default=None))
        check('nonidentity_body_exercised',bool(body_angles) and max(body_angles)>5.,max_angle_deg=max(body_angles,default=None))
        check('noncommuting_order_negative_control_distinguishable',bool(wrong_order) and max(wrong_order)>1.,
              max_wrong_order_error_deg=max(wrong_order,default=None))
    if invalid:
        check('invalid_sensor_clears_ad_and_gnc_valid',all(r['ad_valid']==0 and r['gnc_valid']==0 for r in invalid),samples=len(invalid))
    if expect_invalid:
        check('configured_invalid_case_has_no_valid_measurements',not valid,valid_samples=len(valid))
    truthrows=[r for r in (truth or []) if r.get('stage')=='truth42_sensor' and r.get('valid')]
    truth_errors=[]
    for r in truthrows:
        expected_sensor=mm(mm(dcm(r['mount_qsb']),dcm(r['node_qb'])),dcm(r['body_qbn']))
        truth_errors.append(angle(dcm(r['qsn']),expected_sensor))
    if truth is not None and not expect_invalid:
        check('real_42_sensor_and_truth_observed_separately',len(truthrows)>=min_samples,samples=len(truthrows))
        check('real_42_sensor_geometry_matches_independent_frames',bool(truth_errors) and max(truth_errors)<=tolerance,
              max_rotation_error_deg=max(truth_errors,default=None),tolerance_deg=tolerance)
    result={'schema':'manta.nos3.live-startracker.v1','passed':all(r['passed'] for r in checks),'checks':checks,
            'samples':{'uart_provider':len(provider),'sb_ingest':len(ingest),'adac_valid':len(valid),'adac_invalid':len(invalid),'truth42_valid':len(truthrows)},
            'scope':{'actual_production_uart_simulator':True,'actual_cfs_sb_ingest':True,'actual_production_adac_and_gnc':True,
                     'body_truth_substituted_for_sensor':False,'physical_sensor_qualified':False,
                     'stale_measurement_handling':'not_verified: production input has no timestamp/freshness gate',
                     'live_q_negative_q_coverage':'requires separate configured run; oracle equivalence alone is not live coverage',
                     'invalid_measurement_handling':'observed' if invalid else 'not_exercised'}}
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--sim-log',type=Path,required=True)
    p.add_argument('--fsw-log',type=Path,required=True)
    p.add_argument('--truth-log',type=Path)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--allow-identity-mount',action='store_true')
    p.add_argument('--min-samples',type=int,default=10)
    p.add_argument('--tolerance-deg',type=float,default=0.02)
    p.add_argument('--expect-invalid',action='store_true')
    args=p.parse_args()
    result=verify(rows(args.sim_log),rows(args.fsw_log),rows(args.truth_log) if args.truth_log else None,
                  not args.allow_identity_mount,args.min_samples,args.tolerance_deg,args.expect_invalid)
    result['evidence']=[{'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
                        for path in [args.sim_log,args.fsw_log,args.truth_log] if path]
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'checks':len(result['checks']),'failed':[r['name'] for r in result['checks'] if not r['passed']],'output':str(args.output)}))
    raise SystemExit(0 if result['passed'] else 1)

if __name__=='__main__':
    main()
