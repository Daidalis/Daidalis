#!/usr/bin/env python3
"""Decode actual cFS UDP telemetry with layouts emitted by its C compiler."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
from verify_startracker import rows,q_angle,dcm,angle,mm

def verify(packet_file,fsw_file,min_samples=5,tolerance=0.02,expect_invalid=False):
    fsw=rows(fsw_file)
    layouts=[r for r in fsw if r.get('stage')=='telemetry_layout']
    checks=[]
    def check(name,passed,**detail):
        checks.append({'name':name,'passed':bool(passed),**detail})
    if not layouts:
        return {'passed':False,'checks':[{'name':'actual_c_compiler_packet_layout_available','passed':False}]}
    layout=layouts[-1]; specs={r['mid']:r for r in layout['packets']}
    byteorder='<' if layout['byte_order']=='little' else '>'
    packets=[]; malformed=[]
    for lineno,line in enumerate(packet_file.read_text().splitlines(),1):
        row=json.loads(line)
        if row.get('source')!='telemetry': continue
        data=base64.b64decode(row['packetBase64'],validate=True)
        mid=int.from_bytes(data[:2],'big')
        if mid not in specs: continue
        spec=specs[mid]
        if len(data)!=spec['size']:
            malformed.append({'line':lineno,'mid':mid,'observed_length':len(data),'expected_length':spec['size']}); continue
        if len(data)<6 or int.from_bytes(data[4:6],'big')+7!=len(data):
            malformed.append({'line':lineno,'mid':mid,'reason':'CCSDS declared length mismatch'}); continue
        decoded={'name':spec['name'],'mid':mid,'wallTime':row['wallTime'],
                 'q':list(struct.unpack_from(byteorder+'4d',data,spec['q_offset'])),
                 'valid':data[spec['valid_offset']],'packet_sequence':int.from_bytes(data[2:4],'big')&0x3fff}
        if 'mount_offset' in spec:
            decoded['mount']=list(struct.unpack_from(byteorder+'4d',data,spec['mount_offset']))
        packets.append(decoded)
    groups={name:[p for p in packets if p['name']==name] for name in ['startracker','di','ad','gnc']}
    check('CCSDS_and_native_compiler_lengths_match',not malformed,errors=malformed[:20])
    for name,group in groups.items():
        check('actual_UDP_'+name+'_packets_received',len(group)>=min_samples,samples=len(group))
    ingest=[r for r in fsw if r.get('stage')=='sb_ingest']
    updates=[r for r in fsw if r.get('stage')=='adcs_update' and r.get('sensor_sequence',0)>0]
    unmatched=[]
    for packet in packets:
        source=ingest if packet['name']=='startracker' else updates
        qfield={'startracker':'raw_qsn','di':'di_q','ad':'ad_qbn','gnc':'gnc_qbn'}[packet['name']]
        vfield={'startracker':'valid','di':'di_valid','ad':'ad_valid','gnc':'gnc_valid'}[packet['name']]
        if not any(s[vfield]==packet['valid'] and max(abs(a-b) for a,b in zip(s[qfield],packet['q']))<1e-11 for s in source):
            unmatched.append({'name':packet['name'],'sequence':packet['packet_sequence']})
    check('UDP_values_match_actual_cFS_production_observations',bool(packets) and not unmatched,unmatched=unmatched[:20])
    # A ground request publishes DI, AD, GNC after one ADAC update. Match near
    # wall-clock timestamps with unchanged preceding DI; do not source expected
    # attitude from 42 body truth or from the AD output being tested.
    errors=[]; checked=0
    for packet in groups['gnc']:
        candidates=[di for di in groups['di'] if di['valid'] and abs(di['wallTime']-packet['wallTime'])<0.15]
        if not packet['valid'] or not candidates: continue
        near=min(candidates,key=lambda di:abs(di['wallTime']-packet['wallTime']))
        expected=mm(dcm(near['mount']),dcm(near['q']))
        errors.append(angle(dcm(packet['q']),expected)); checked+=1
    if not expect_invalid:
        check('UDP_GNC_matches_sensor_frame_model',checked>=min_samples and max(errors,default=float('inf'))<=tolerance,
              samples=checked,max_error_deg=max(errors,default=None),tolerance_deg=tolerance)
    else:
        check('UDP_invalid_measurement_propagates_invalid_AD_GNC',
              len(groups['ad'])>=min_samples and len(groups['gnc'])>=min_samples and
              all(p['valid']==0 for name in ['di','ad','gnc'] for p in groups[name]),
              samples={name:len(groups[name]) for name in ['di','ad','gnc']})
    return {'schema':'manta.nos3.live-udp.v1','passed':all(c['passed'] for c in checks),'checks':checks,
            'packet_counts':{name:len(group) for name,group in groups.items()},'compiler_layout':layout,
            'decoded_packets':packets,'limitations':['Temporal ground DI/GNC pairing is bounded to 150 ms; exact sensor sequence correspondence is separately checked in production probes.']}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--packets',required=True,type=Path)
    p.add_argument('--fsw-log',required=True,type=Path); p.add_argument('--output',required=True,type=Path)
    p.add_argument('--expect-invalid',action='store_true'); p.add_argument('--min-samples',default=5,type=int)
    args=p.parse_args(); result=verify(args.packets,args.fsw_log,args.min_samples,expect_invalid=args.expect_invalid)
    result['evidence']=[{'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in [args.packets,args.fsw_log]]
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'checks':len(result['checks']),'failed':[c['name'] for c in result['checks'] if not c['passed']],'output':str(args.output)}))
    raise SystemExit(0 if result['passed'] else 1)

if __name__=='__main__': main()
