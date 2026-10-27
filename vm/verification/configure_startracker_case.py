#!/usr/bin/env python3
"""Configure matching physical sensor mounting and ADCS inverse in a private copy."""
import argparse
import json
import math
from pathlib import Path
from verify_startracker import mm, transpose

def axis_rotation(axis,degrees):
    t=math.radians(degrees); c=math.cos(t); s=math.sin(t)
    if axis==1: return [[1.,0.,0.],[0.,c,s],[0.,-s,c]]
    if axis==2: return [[c,0.,-s],[0.,1.,0.],[s,0.,c]]
    if axis==3: return [[c,s,0.],[-s,c,0.],[0.,0.,1.]]
    raise ValueError('Invalid Euler axis')

def euler_dcm(angles,sequence):
    result=[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]]
    for axis,degree in zip(str(sequence),angles):
        result=mm(axis_rotation(int(axis),degree),result)
    return result

def matrix_quaternion(passive):
    # Convert the transposed passive DCM with an independent active-matrix recipe.
    a=transpose(passive); trace=sum(a[i][i] for i in range(3))
    if trace>0:
        s=2*math.sqrt(1+trace)
        q=[(a[2][1]-a[1][2])/s,(a[0][2]-a[2][0])/s,(a[1][0]-a[0][1])/s,s/4]
    else:
        i=max(range(3),key=lambda k:a[k][k]); j=(i+1)%3; k=(i+2)%3
        s=2*math.sqrt(1+a[i][i]-a[j][j]-a[k][k]); q=[0.,0.,0.,0.]
        q[i]=s/4; q[j]=(a[j][i]+a[i][j])/s; q[k]=(a[k][i]+a[i][k])/s; q[3]=(a[k][j]-a[j][k])/s
    n=math.sqrt(sum(x*x for x in q))
    return [x/n for x in q]

def replace_section_value(text,section,relative,value):
    lines=text.splitlines(); matches=[i for i,l in enumerate(lines) if section in l]
    if len(matches)!=1:
        raise ValueError(f'Expected exactly one section {section}')
    index=matches[0]+relative
    comment=lines[index].split('!',1)[1] if '!' in lines[index] else ''
    lines[index]=value+(' !'+comment if comment else '')
    return '\n'.join(lines)+'\n'

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--inout',type=Path,help='Actual private 42 InOut directory; defaults to COPY/cfg/InOut')
    p.add_argument('--di-file',type=Path,help='Actual installed Inp_DI.txt; defaults to source cfg')
    p.add_argument('--case',choices=['identity','noncommuting','invalid'],default='noncommuting')
    args=p.parse_args(); root=args.source.resolve()
    if not(root/'.manta-isolated-nos3').is_file():
        raise SystemExit('Source must have .manta-isolated-nos3 marker')
    inout=(args.inout or root/'cfg/InOut').resolve()
    di=(args.di_file or root/'components/generic_adcs/fsw/shared/cfg/Inp_DI.txt').resolve()
    # Allow the source parent only for conventional private build/install siblings.
    if root.parent not in inout.parents or root.parent not in di.parents:
        raise SystemExit('Configuration paths must remain inside private source/build parent')
    spacecraft=inout/'SC_NOS3.txt'
    angles=[0.,0.,0.] if args.case=='identity' else [23.,-31.,17.]
    csb=euler_dcm(angles,213); qbs=matrix_quaternion(transpose(csb))
    # Selected from captured real orbit/nadir geometry: Earth limb cosine 0.3384,
    # while this mounted sensor's nadir cosine is 0.1564 (unobscured).
    body_axis=[1.,0.,0.]
    half=math.radians(143.)/2
    body=[a*math.sin(half) for a in body_axis]+[math.cos(half)]
    data=spacecraft.read_text()
    data=replace_section_value(data,'Initial Attitude',1,'NQN')
    data=replace_section_value(data,'Initial Attitude',2,'0.0 0.0 0.0')
    data=replace_section_value(data,'Initial Attitude',3,' '.join(format(x,'.17g') for x in body))
    data=replace_section_value(data,'ST 0 ===',1,'0.1')
    data=replace_section_value(data,'ST 0 ===',2,' '.join(str(a) for a in angles)+' 213')
    # Zero noise isolates frame/transport defects; separate noisy cases may follow.
    data=replace_section_value(data,'ST 0 ===',6,'0.0 0.0 0.0')
    if args.case=='invalid':
        # 180-degree Sun exclusion deterministically invalidates any non-exact-antipodal bore.
        data=replace_section_value(data,'ST 0 ===',5,'180.0 10.0 10.0')
    else:
        data=replace_section_value(data,'ST 0 ===',5,'0.0 0.0 0.0')
    spacecraft.write_text(data)
    ditext=di.read_text()
    ditext=replace_section_value(ditext,'Star Tracker',1,' '.join(format(x,'.17g') for x in qbs))
    di.write_text(ditext)
    report={'case':args.case,'mounting_euler_deg':angles,'mounting_euler_sequence':213,
            'physical_mount_Csb':csb,'adcs_mount_qbs':qbs,'initial_body_qbn':body,
            'sensor_noise_arcsec':[0.,0.,0.],
            'purpose':'zero-noise software integration frame/transport verification',
            'caveat':'zero exclusion angles retain geometric Earth/Moon limb occultation; require observed valid samples',
            'files':[str(spacecraft),str(di)]}
    (root/f'manta-case-{args.case}.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':
    main()
