import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createContainerDesktop} from '../server/container-desktop.mjs';
test('desktop screenshots are validated and stored under application-owned filenames',async t=>{
  const shots=await fs.mkdtemp(path.join(os.tmpdir(),'manta-desktop-'));t.after(()=>fs.rm(shots,{recursive:true,force:true}));
  const driver=createContainerDesktop({socketPath:'/test',shots,request:async()=>({contentBase64:Buffer.from('not a png').toString('base64')})});
  await assert.rejects(driver.action({action:'desktop.screenshot'}),/Invalid desktop screenshot/);
  assert.deepEqual(await fs.readdir(shots),[]);
});
