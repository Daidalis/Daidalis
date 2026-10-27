import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {professionalToolCatalog,createEngineeringService} from '../server/engineering.mjs';

const catalog=options=>professionalToolCatalog({findExecutable:()=>null,applicationNames:()=>[],directoryExists:()=>false,realpath:p=>p,...options});
const find=(tools,id)=>tools.find(t=>t.id===id);

test('professional executable detection never implies integrated execution or license validity',()=>{
  const tools=catalog({findExecutable:names=>names.includes('omc')?'/opt/test/bin/omc':names.includes('capella')?'/opt/test/bin/capella':null});
  for(const id of ['openmodelica','capella']){
    const t=find(tools,id);
    assert.equal(t.detected,true);assert.equal(t.installed,true);
    assert.equal(t.available,false);assert.equal(t.integrated,false);
    assert.equal(t.status,'detected-not-integrated');
    assert.equal(t.licenseVerified,false);assert.equal(t.versionVerified,false);assert.equal(t.launchVerified,false);
  }
  assert.equal(find(tools,'omsimulator').status,'missing');
});

test('PATH MATLAB is cataloged separately and does not imply Simulink files',()=>{
  const tools=catalog({findExecutable:names=>names.includes('matlab')?'/usr/local/bin/matlab':null});
  const matlab=find(tools,'matlab'),simulink=find(tools,'simulink');
  assert.equal(matlab.detected,true);assert.equal(matlab.available,false);
  assert.match(matlab.role,/数值/);assert.match(matlab.role,/控制设计/);
  assert.equal(simulink.detected,false);assert.equal(simulink.installed,false);
  assert.equal(simulink.executable,null);assert.equal(simulink.status,'missing');
  assert.match(simulink.role,/离散采样/);assert.match(simulink.interface,/Simulink Coder/);
});

test('bounded MATLAB application discovery associates Simulink with the correct installation',()=>{
  const latest='/Applications/MATLAB_R2026b.app',older='/Applications/MATLAB_R2025b.app';
  const probes=[],directoryProbes=[];
  const tools=catalog({
    applicationNames:()=>['MATLAB_R2025b.app','MATLAB_R2026b.app','MATLAB_R2024a.app/../../bad','Other.app'],
    findExecutable:names=>{probes.push(...names);return names.find(p=>p===latest+'/bin/matlab'||p===older+'/bin/matlab')||null;},
    directoryExists:p=>{directoryProbes.push(p);return p===older+'/toolbox/simulink';},
  });
  assert.equal(find(tools,'matlab').executable,latest+'/bin/matlab');
  const simulink=find(tools,'simulink');
  assert.equal(simulink.productPath,older+'/toolbox/simulink');
  assert.equal(simulink.executable,older+'/bin/matlab');
  assert.equal(simulink.detected,true);assert.equal(simulink.available,false);
  assert.equal(simulink.status,'detected-not-integrated');
  assert.ok(probes.includes(older+'/bin/matlab'));
  assert.ok(probes.every(p=>!p.includes('..')));
  assert.ok(directoryProbes.every(p=>p.startsWith('/Applications/MATLAB_R')&&p.endsWith('/toolbox/simulink')));
});

test('PATH MATLAB symlink resolves only its explicit installation for product detection',()=>{
  const tools=catalog({
    findExecutable:names=>names.includes('matlab')?'/usr/local/bin/matlab':names.find(p=>p==='/opt/MATLAB/R2026b/bin/matlab')||null,
    realpath:p=>p==='/usr/local/bin/matlab'?'/opt/MATLAB/R2026b/bin/matlab':p,
    directoryExists:p=>p==='/opt/MATLAB/R2026b/toolbox/simulink',
  });
  assert.equal(find(tools,'simulink').productPath,'/opt/MATLAB/R2026b/toolbox/simulink');
  assert.equal(find(tools,'simulink').available,false);
});

test('catalog rechecks professional detection without importing numerical dependencies',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-catalog-refresh-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  let installed=false,checks=0;
  const service=await createEngineeringService({root:temp,dataDir:temp,pythonPath:path.join(temp,'no-python-installed'),professionalCatalog:()=>{
    checks++;
    return catalog({findExecutable:names=>installed&&names.includes('matlab')?'/usr/local/bin/matlab':null});
  }});
  assert.equal(checks,0,'professional catalog must not be frozen at service startup');
  const first=await service.catalog();
  assert.equal(find(first.tools,'matlab').detected,false);
  installed=true;
  const second=await service.catalog();
  assert.equal(checks,2);
  assert.equal(find(second.tools,'matlab').detected,true);
  assert.equal(find(second.tools,'matlab').status,'detected-not-integrated');
  assert.equal(find(second.tools,'matlab').available,false);
  assert.equal(second.runtime.professionalTools.probeMode,'each-catalog-call');
  assert.equal(second.runtime.professionalTools.launchProducts,false);
  assert.equal(second.runtime.scipy.probeMode,'on-demand-cached');
  assert.equal(second.runtime.scipy.recheck,'on-demand');
  assert.equal(second.runtime.scipy.probedAt,first.runtime.scipy.probedAt);
  assert.equal(find(second.tools,'scipy').available,false);
});
