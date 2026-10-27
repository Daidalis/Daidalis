#!/usr/bin/env python3
"""Add read-only observations to real 42 StarTrackerModel in an isolated copy."""
import argparse
import hashlib
import json
from pathlib import Path

PROBE=r'''
               /* Manta observation only: truth never enters the sensor consumer. */
               printf("MANTA_TRACE {\"stage\":\"truth42_sensor\",\"valid\":%ld,\"qsn\":[%.17g,%.17g,%.17g,%.17g],\"body_qbn\":[%.17g,%.17g,%.17g,%.17g],\"mount_qsb\":[%.17g,%.17g,%.17g,%.17g],\"node_qb\":[%.17g,%.17g,%.17g,%.17g]}\n", (long)ST->Valid,ST->qn[0],ST->qn[1],ST->qn[2],ST->qn[3],S->B[0].qn[0],S->B[0].qn[1],S->B[0].qn[2],S->B[0].qn[3],ST->qb[0],ST->qb[1],ST->qb[2],ST->qb[3],N->qb[0],N->qb[1],N->qb[2],N->qb[3]);
               fflush(stdout);
'''
VISIBILITY=r'''
            printf("MANTA_TRACE {\"stage\":\"truth42_visibility\",\"valid\":%ld,\"sun_boresight_cosine\":%.17g,\"nadir_boresight_cosine\":%.17g,\"earth_limb_cosine\":%.17g,\"body_qbn\":[%.17g,%.17g,%.17g,%.17g]}\n",(long)ST->Valid,BoS,BoN,cos(asin(W->rad/OrbRad)),S->B[0].qn[0],S->B[0].qn[1],S->B[0].qn[2],S->B[0].qn[3]);
            fflush(stdout);
'''

def main():
    p=argparse.ArgumentParser(); p.add_argument('--source',required=True,type=Path); args=p.parse_args()
    root=args.source.resolve()
    if not(root/'.manta-isolated-42').is_file():
        raise SystemExit('Missing .manta-isolated-42 marker')
    path=root/'Source/42sensors.c'; backup=path.with_name(path.name+'.manta-original')
    old=(backup if backup.exists() else path).read_text()
    pin=json.loads((Path(__file__).resolve().parent/'pinned-source-hashes.json').read_text())['42']['Source/42sensors.c']
    if hashlib.sha256(old.encode()).hexdigest()!=pin:
        raise SystemExit('Pinned original 42 source hash mismatch; refusing changed baseline')
    anchor='               QxQ(Qnoise,qsn,ST->qn);'
    if old.count(anchor)!=1: raise SystemExit('Unexpected 42 StarTrackerModel source; refusing broad patch')
    new=old.replace(anchor,anchor+'\n'+PROBE,1)
    validity='            if (ST->Valid) {'
    if new.count(validity)!=1: raise SystemExit('Unexpected 42 star-tracker validity branch')
    new=new.replace(validity,VISIBILITY+'\n'+validity,1)
    if not backup.exists(): backup.write_text(old)
    path.write_text(new)
    manifest={'stage':'42 sensor geometry observations only','original_sha256':hashlib.sha256(old.encode()).hexdigest(),'instrumented_sha256':hashlib.sha256(new.encode()).hexdigest()}
    (root/'manta-truth42-probe.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))

if __name__=='__main__': main()
