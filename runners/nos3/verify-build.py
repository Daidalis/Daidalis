#!/usr/bin/env python3
"""Collect real build evidence; never turn an empty build into a pass."""
import hashlib,json,pathlib,sys
root=pathlib.Path.cwd(); output=root/'manta-verification';output.mkdir(exist_ok=True)
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
targets=[('FSW-BINARY','fsw/build/exe/cpu1/core-cpu1'),('SIM-BINARY','sims/build/bin/nos3-single-simulator')]
checks=[];files=[]
for check_id,name in targets:
    candidate=root/name;present=candidate.is_file() and candidate.stat().st_size>0
    checks.append({'id':check_id,'criterion':'NOS3 build produces nonempty native binary '+name,'passed':present})
    if present:files.append({'path':name,'sha256':digest(candidate),'bytes':candidate.stat().st_size})
report={'schema':'manta-nos3-verification-v1','scope':'build','fullNos3Simulation':False,'passed':all(x['passed'] for x in checks),'checks':checks,'builtFiles':files,'limitations':['Build evidence does not prove integration behavior or mission requirements.']}
(output/'build.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));sys.exit(0 if report['passed'] else 1)
