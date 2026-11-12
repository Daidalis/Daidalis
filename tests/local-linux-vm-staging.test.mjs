import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stageManagedWorkerBundle} from '../server/local-linux-vm.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-incremental-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'worker','nested'),{recursive:true});
  await fs.writeFile(path.join(root,'worker','provision-worker.sh'),'fixed provision');
  await fs.writeFile(path.join(root,'worker','prepare-native.sh'),'fixed preparation');
  await fs.writeFile(path.join(root,'worker','nested','data.txt'),'first');
  return {root,target:path.join(root,'handoff','worker'),source:path.join(root,'worker')};
}

test('repeat staging preserves inode/mtime and unknown open files; changes replace only selected file',async t=>{
  const f=await fixture(t);
  assert.equal((await stageManagedWorkerBundle(f.root)).changed,3);
  const tracked=path.join(f.target,'nested','data.txt'),before=await fs.stat(tracked),directory=await fs.stat(f.target);
  const unknown=path.join(f.target,'nested','.smbdelete-live');await fs.writeFile(unknown,'must remain');
  const opened=await fs.open(tracked,'r');t.after(()=>opened.close());
  const second=await stageManagedWorkerBundle(f.root);
  assert.equal(second.changed,0);assert.equal(second.unchanged,3);
  assert.equal((await fs.stat(tracked)).ino,before.ino);assert.equal((await fs.stat(tracked)).mtimeMs,before.mtimeMs);
  await fs.writeFile(path.join(f.source,'nested','data.txt'),'second version');
  const third=await stageManagedWorkerBundle(f.root);
  assert.equal(third.changed,1);assert.equal(third.unchanged,2);
  assert.equal(await fs.readFile(tracked,'utf8'),'second version');
  assert.equal(await opened.readFile('utf8'),'first');
  assert.equal((await fs.stat(f.target)).ino,directory.ino);
  assert.equal(await fs.readFile(unknown,'utf8'),'must remain');
});

test('source symbolic link fails before any existing staged content is changed',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  await fs.writeFile(path.join(f.source,'nested','data.txt'),'changed');
  await fs.symlink('/etc/passwd',path.join(f.source,'untrusted'));
  await assert.rejects(stageManagedWorkerBundle(f.root),/symbolic links/);
  assert.equal(await fs.readFile(path.join(f.target,'nested','data.txt'),'utf8'),'first');
});

test('target leaf symlink cannot overwrite an outside file',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  const outside=path.join(f.root,'outside');await fs.writeFile(outside,'outside');
  await fs.unlink(path.join(f.target,'nested','data.txt'));await fs.symlink(outside,path.join(f.target,'nested','data.txt'));
  await assert.rejects(stageManagedWorkerBundle(f.root),/symbolic link/);
  assert.equal(await fs.readFile(outside,'utf8'),'outside');
});

test('target ancestor symlink is rejected without touching outside directory',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  const outside=path.join(f.root,'outside');await fs.mkdir(outside);
  await fs.rm(path.join(f.target,'nested'),{recursive:true});await fs.symlink(outside,path.join(f.target,'nested'));
  await assert.rejects(stageManagedWorkerBundle(f.root),/symbolic link/);
  assert.deepEqual(await fs.readdir(outside),[]);
});

test('oversized bundle is rejected before changing any staged file',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  await fs.writeFile(path.join(f.source,'nested','data.txt'),'changed');
  const huge=await fs.open(path.join(f.source,'oversized'),'w');await huge.truncate(64*1024*1024);await huge.close();
  await assert.rejects(stageManagedWorkerBundle(f.root),/size limit/);
  assert.equal(await fs.readFile(path.join(f.target,'nested','data.txt'),'utf8'),'first');
});

test('stale entry script cannot stand in for a missing source entry',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  await fs.unlink(path.join(f.source,'provision-worker.sh'));
  await assert.rejects(stageManagedWorkerBundle(f.root),/missing its fixed entry/);
});

test('an existing handoff receives the current pinned native source and verifier without replacing archives or downloaded source',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  for(const directory of ['nos3-plan','verification']){
    await fs.mkdir(path.join(f.root,directory));
    await fs.mkdir(path.join(f.root,'handoff',directory));
  }
  for(const relative of ['nos3-plan/run_native.py','verification/verify_all.py']){
    await fs.copyFile(new URL('../vm/'+relative,import.meta.url),path.join(f.root,relative));
    await fs.writeFile(path.join(f.root,'handoff',relative),'previous deployed source');
  }
  await fs.copyFile(new URL('../vm/worker/native-inputs.json',import.meta.url),path.join(f.source,'native-inputs.json'));
  // Program staging must not follow or refresh arbitrary neighboring trees.
  await fs.mkdir(path.join(f.root,'source'));await fs.symlink('/etc/passwd',path.join(f.root,'source','unreviewed'));
  await fs.mkdir(path.join(f.root,'handoff','source'));
  const preserved=path.join(f.root,'handoff','source','manifest.json'),archive=path.join(f.root,'handoff','nos3-source.tar.gz');
  await fs.writeFile(preserved,'existing downloaded source metadata');await fs.writeFile(archive,'existing pinned archive');
  const before=await fs.stat(preserved),archiveBefore=await fs.stat(archive),shareBefore=await fs.stat(path.join(f.root,'handoff'));
  const result=await stageManagedWorkerBundle(f.root);
  assert.equal(result.changed,3);assert.equal(result.unchanged,3);
  const manifest=JSON.parse(await fs.readFile(path.join(f.target,'native-inputs.json'),'utf8'));
  const bytes=await fs.readFile(path.join(f.root,'handoff','nos3-plan','run_native.py'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.stagedFiles['nos3-plan/run_native.py']);
  for(const relative of ['nos3-plan/run_native.py','verification/verify_all.py'])assert.deepEqual(await fs.readFile(path.join(f.root,'handoff',relative)),await fs.readFile(path.join(f.root,relative)));
  assert.equal((await stageManagedWorkerBundle(f.root)).changed,0);
  assert.equal(await fs.readFile(preserved,'utf8'),'existing downloaded source metadata');assert.equal((await fs.stat(preserved)).ino,before.ino);
  assert.equal(await fs.readFile(archive,'utf8'),'existing pinned archive');assert.equal((await fs.stat(archive)).ino,archiveBefore.ino);
  assert.equal((await fs.stat(path.join(f.root,'handoff'))).ino,shareBefore.ino);
  await assert.rejects(fs.lstat(path.join(f.root,'handoff','source','unreviewed')),{code:'ENOENT'});
});

for(const directory of ['nos3-plan','verification'])test('optional program source '+directory+' rejects a symlink before any staged file changes',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'program.py'),'outside');
  await fs.symlink(outside,path.join(f.root,directory));await fs.writeFile(path.join(f.source,'nested','data.txt'),'changed');
  await assert.rejects(stageManagedWorkerBundle(f.root),/symbolic link/);
  assert.equal(await fs.readFile(path.join(f.target,'nested','data.txt'),'utf8'),'first');
  assert.equal(await fs.readFile(path.join(outside,'program.py'),'utf8'),'outside');
});

for(const directory of ['nos3-plan','verification'])test('optional program target '+directory+' rejects a symlink without writing outside the share',async t=>{
  const f=await fixture(t);await stageManagedWorkerBundle(f.root);
  await fs.mkdir(path.join(f.root,directory));await fs.writeFile(path.join(f.root,directory,'program.py'),'reviewed program');
  const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(f.root,'handoff',directory));
  await assert.rejects(stageManagedWorkerBundle(f.root),/symbolic link/);
  assert.deepEqual(await fs.readdir(outside),[]);
});
