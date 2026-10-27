import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSettingsService,DEFAULT_SETTINGS,validateSettingsPatch} from '../server/settings.mjs';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'syspilot-settings-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('settings defaults persist independently and external result mutations cannot alter state',async t=>{
  const dir=await fixture(t),service=await createSettingsService({dataDir:dir});
  assert.deepEqual(service.get(),{defaultPermissionMode:'manual',appearance:'system'});
  const copy=service.get();copy.defaultPermissionMode='auto';copy.appearance='dark';
  assert.deepEqual(service.get(),DEFAULT_SETTINGS);
  const stat=await fs.stat(path.join(dir,'settings.json'));
  assert.equal(stat.mode&0o777,0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')),DEFAULT_SETTINGS);
  assert.deepEqual(await fs.readdir(dir),['settings.json']);
});

test('settings reject unknown fields, invalid enums and ambiguous payloads without persisting partial changes',async t=>{
  const dir=await fixture(t),service=await createSettingsService({dataDir:dir});
  const invalidInputs=[null,[],{},'dark',{appearance:'Dark'},{appearance:null},{appearance:1},{defaultPermissionMode:true},{defaultPermissionMode:'always'},{usage:true},{appearance:'dark',maxConcurrentAgents:8},JSON.parse('{"__proto__":{"appearance":"dark"}}')];
  for(const input of invalidInputs){
    assert.throws(()=>validateSettingsPatch(input),error=>error.status===400&&error.code==='INVALID_SETTINGS');
    await assert.rejects(service.patch(input),error=>error.status===400);
  }
  assert.deepEqual(service.get(),DEFAULT_SETTINGS);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')),DEFAULT_SETTINGS);
});

test('concurrent partial updates serialize without losing either setting and survive restart',async t=>{
  const dir=await fixture(t),service=await createSettingsService({dataDir:dir});
  const results=await Promise.all([service.patch({appearance:'dark'}),service.patch({defaultPermissionMode:'auto'})]);
  assert.deepEqual(results[0],{defaultPermissionMode:'manual',appearance:'dark'});
  assert.deepEqual(results[1],{defaultPermissionMode:'auto',appearance:'dark'});
  results[1].appearance='light';
  assert.deepEqual(service.get(),{defaultPermissionMode:'auto',appearance:'dark'});
  assert.deepEqual((await createSettingsService({dataDir:dir})).get(),service.get());
  assert.equal((await fs.stat(path.join(dir,'settings.json'))).mode&0o777,0o600);
  assert.deepEqual(await fs.readdir(dir),['settings.json']);
});

test('failed persistence leaves the in-memory setting unchanged and later patches still work',async t=>{
  const dir=await fixture(t),service=await createSettingsService({dataDir:dir}),file=path.join(dir,'settings.json');
  await fs.unlink(file);await fs.mkdir(file);
  await assert.rejects(service.patch({appearance:'dark'}),error=>error.status===500);
  assert.deepEqual(service.get(),DEFAULT_SETTINGS);
  await fs.rmdir(file);
  assert.deepEqual(await service.patch({appearance:'light'}),{defaultPermissionMode:'manual',appearance:'light'});
  assert.deepEqual(await fs.readdir(dir),['settings.json']);
});

test('unreadable or unknown persisted settings are preserved rather than silently reset',async t=>{
  const dir=await fixture(t),file=path.join(dir,'settings.json');
  for(const contents of ['{invalid',JSON.stringify({appearance:'dark',unknown:true}),JSON.stringify({defaultPermissionMode:'elevated'})]){
    await fs.writeFile(file,contents);
    await assert.rejects(createSettingsService({dataDir:dir}),error=>error.status===500);
    assert.equal(await fs.readFile(file,'utf8'),contents);
  }
});

test('a settings symlink is refused and its external target is untouched',async t=>{
  const dir=await fixture(t),target=path.join(dir,'outside.json'),file=path.join(dir,'settings.json');
  const original=JSON.stringify({appearance:'dark'});await fs.writeFile(target,original);await fs.symlink(target,file);
  await assert.rejects(createSettingsService({dataDir:dir}),error=>error.status===500);
  assert.equal(await fs.readFile(target,'utf8'),original);
});
