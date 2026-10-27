import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stageManagedWorkerBundle} from '../server/local-linux-vm.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-incremental-'));
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
