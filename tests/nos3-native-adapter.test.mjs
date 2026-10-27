import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createNativeNos3Adapter} from '../runners/nos3/native-adapter.mjs';
import {sha256,sourceFingerprint} from '../server/nos3/core.mjs';

test('native source adapter ties immutable archive inventory to requested Git pins and file bytes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-native-pins-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'nos3/components/generic_adcs'),{recursive:true});const rel='nos3/components/generic_adcs/source.c';await fs.writeFile(path.join(root,rel),'original');
  const manifest=[{repo:'nasa/nos3',revision:'a'.repeat(40)},{path:'components/generic_adcs',repo:'nasa-itc/generic_adcs',revision:'b'.repeat(40)}];
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest));
  const inventory=JSON.stringify({schema:'manta-nos3-native-source-v1',manifestSha256:sha256(JSON.stringify(manifest)),files:[{path:rel,bytes:8,sha256:sha256('original')}]});await fs.writeFile(path.join(root,'integrity.json'),inventory);
  const adapter=createNativeNos3Adapter({sourceRoot:root,toolRoot:root,workRoot:root,expectedInventoryHash:sha256(inventory)});
  const baseline={revision:'a'.repeat(40),submodules:[{path:'components/generic_adcs',revision:'b'.repeat(40)}],sourceFiles:[{path:'components/generic_adcs/source.c',sha256:sha256('original')}]};baseline.baselineHash=sourceFingerprint(baseline);
  assert.equal((await adapter.validateSource(baseline)).verifiedFiles,1);
  const mismatched={...baseline,revision:'c'.repeat(40)};mismatched.baselineHash=sourceFingerprint(mismatched);await assert.rejects(adapter.validateSource(mismatched),/root revision/);
  await fs.writeFile(path.join(root,rel),'tampered');await assert.rejects(adapter.validateSource(baseline),/source integrity/);
  await fs.writeFile(path.join(root,'integrity.json'),inventory+' ');await assert.rejects(adapter.validateSource(baseline),/provisioned integrity receipt/);
});
