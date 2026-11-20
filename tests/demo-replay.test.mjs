import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore,revealDemoFiles} from '../server/store.mjs';

const exampleDir=fileURLToPath(new URL('../examples/electric-sedan',import.meta.url));
function fileURLToPath(url){return new URL(url).pathname;}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-replay-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('the recorded sedan demo timeline is honest about what it references',async()=>{
  const replay=JSON.parse(await fs.readFile(path.join(exampleDir,'replay.json'),'utf8'));
  assert.equal(replay.schema,'daidalis-demo-replay-v1');
  assert.equal(replay.provenance,'curated');
  assert.match(replay.note,/真实会话消息/);
  assert.match(replay.note,/环境故障与续跑指令不在演示时间轴内/);
  assert.ok(typeof replay.prompt==='string'&&replay.prompt.length>50);
  // the timeline follows the original session's full duration, in order
  assert.equal(replay.durationSeconds,1223);
  let previousT=0;
  for(const entry of replay.entries){assert.ok(Number.isFinite(entry.t)&&entry.t>=previousT,'entry t is ordered');previousT=entry.t;}
  assert.equal(previousT,replay.durationSeconds,'the last entry closes the session timeline');
  const kinds=new Set(replay.entries.map(entry=>entry.kind));
  assert.deepEqual([...kinds].sort(),['activity','message','modeling']);
  for(const [index,entry] of replay.entries.entries()){
    assert.ok(['message','activity','modeling'].includes(entry.kind),`entry ${index} has a known kind`);
    if(entry.kind==='modeling')assert.ok(entry.do&&['open','stl','recorded','event'].includes(entry.do),`entry ${index} has a known modeling action`);
  }
  // the cleaned log keeps neither gateway errors nor continuation instructions
  for(const entry of replay.entries){
    if(entry.kind==='message'){
      assert.doesNotMatch(entry.content||'',/运行失败|API Error|Isolated native Agents/,'environment errors are removed');
      assert.doesNotMatch(entry.content||'',/从中断处/,'interruption wording is removed');
      if(entry.role==='user')assert.equal(entry.usePrompt,true,'the only user entry is the original task');
    }
  }
  // every referenced project file exists beside the timeline
  const resolveExample=entryPath=>path.join(exampleDir,path.relative('electric-sedan',entryPath));
  for(const entry of replay.entries)if(entry.kind==='modeling'&&entry.path)await fs.access(resolveExample(entry.path));
  // every explicit reveal names a retained file that exists beside the timeline
  for(const entry of replay.entries)for(const item of entry.reveal||[])await fs.access(resolveExample(item));
  // the geometry assembles step by step through the archived real scad drafts, never the finished car first
  const geometrySteps=replay.entries.filter(entry=>entry.kind==='modeling'&&entry.do==='stl');
  assert.equal(geometrySteps.length,5,'the body assembles through five rendered scad drafts');
  const sizes=[];
  for(const step of geometrySteps){
    const stl=await fs.readFile(resolveExample(step.path));
    assert.ok(stl.length>1000,`${step.path} is a real mesh`);
    sizes.push(stl.length);
  }
  assert.ok(sizes[0]<sizes.at(-1),`the first draft is coarser than the delivered mesh (${sizes.join(' → ')})`);
  const last=String(resolveExample(geometrySteps.at(-1).path)).split('/').at(-1);
  assert.equal(last,'final.stl','the last step is the delivered Sedan.scad mesh');
  // the retained artifacts the narrative claims are real
  const manifest=JSON.parse(await fs.readFile(path.join(exampleDir,'Sedan.recorded.json'),'utf8'));
  assert.equal(manifest.provenance,'fmu-run');
  assert.equal(manifest.csv,'trajectory.csv');
  const rows=String(await fs.readFile(path.join(exampleDir,'trajectory.csv'),'utf8')).trim().split('\n').length-1;
  assert.equal(rows,751);
  const passed=manifest.checks.filter(check=>check.passed===true).length,failed=manifest.checks.filter(check=>check.passed===false).length;
  assert.equal(passed+failed,manifest.checks.length);
  assert.ok(failed>0,'the cruise criterion failure is retained, not hidden');
  // the timeline states the same verdict counts the manifest records
  const verdictEntries=replay.entries.filter(entry=>entry.kind==='activity'&&/判据/.test(entry.verificationLabel||''));
  assert.ok(verdictEntries.length>=1,'the timeline states the criterion outcome');
  for(const verdictEntry of verdictEntries)assert.match(verdictEntry.verificationLabel,new RegExp(`判据 ${passed}/${passed+failed} 通过`));
});

test('a fresh store seeds only the demo replay project with byte-identical retained files',async t=>{
  const root=await fixture(t);
  const store=createStore({dataDir:path.join(root,'.local'),seed:true});
  assert.equal(store.data.projects.length,1);
  const demo=store.data.projects[0];
  assert.equal(demo.kind,'demo-replay');
  assert.match(demo.name,/^示例$/);
  assert.match(demo.description,/留存产物/);
  // the conversation starts empty; the recorded prompt is prefilled by the composer, not seeded as a message
  assert.equal(store.data.messages.filter(message=>message.projectId===demo.id).length,0);
  const folder=store.workspace(demo.id);
  // all retained artifacts start in the hidden staging folder, never in the visible workspace
  const staged=name=>path.join(folder,'.daidalis','replay-assets','electric-sedan',name);
  for(const name of ['replay.json','prompt.md','Sedan.sysml','Sedan.appearance.sysml','Sedan.scad','Sedan.fmu','trajectory.csv','Sedan.recorded.json','Sedan.mo','电动轿车交付与验证报告.md','engineering/geometry-stages/final.stl','engineering/geometry-stages/stage2.stl']){
    const copied=staged(name),original=path.join(exampleDir,name);
    await fs.access(copied);
    assert.deepEqual(await fs.readFile(copied),await fs.readFile(original),`${name} is byte-identical`);
    await assert.rejects(fs.access(path.join(folder,'electric-sedan',name)),`${name} stays staged until the timeline reveals it`);
  }
  // the ordered model-version archive travels with the example
  const history=String(await fs.readFile(staged('.daidalis/professional-model-history/index.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(history.length,8);
  for(let index=1;index<history.length;index++)assert.ok(history[index-1].savedAt<=history[index].savedAt,'the process index is in save order');
  for(const row of history)await fs.access(staged('.daidalis/professional-model-history/'+row.sha256+path.extname(row.path)));
  await fs.access(path.join(folder,'replay.json'));
  // revealing is the only bridge from staging into the workspace: idempotent and escape-proof
  const {revealed,skipped}=await revealDemoFiles(folder,['electric-sedan/Sedan.sysml','electric-sedan/Sedan.recorded.json','../escape.sysml','/absolute.stl']);
  assert.deepEqual(revealed,['electric-sedan/Sedan.sysml','electric-sedan/Sedan.recorded.json']);
  assert.equal(skipped.length,2,'path escapes are refused, not copied');
  assert.deepEqual(await fs.readFile(path.join(folder,'electric-sedan','Sedan.sysml')),await fs.readFile(path.join(exampleDir,'Sedan.sysml')),'the revealed file is byte-identical');
  const again=await revealDemoFiles(folder,['electric-sedan/Sedan.sysml']);
  assert.deepEqual(again.revealed,[],'an already revealed file is not copied again');
  // a persisted store does not seed twice
  const reopened=createStore({dataDir:path.join(root,'.local'),seed:true});
  assert.equal(reopened.data.projects.length,1);
  // an instance that already has real projects but no demo still seeds the example (container case)
  const neighborRoot=path.join(root,'.neighbor'),neighbor=createStore({dataDir:neighborRoot,seed:true});
  neighbor.createProject({name:'工程项目',description:''});
  neighbor.data.projects=neighbor.data.projects.filter(x=>x.kind!=='demo-replay');
  neighbor.save();
  const regrown=createStore({dataDir:neighborRoot,seed:true});
  assert.equal(regrown.data.projects.length,2,'the demo is seeded beside real projects');
  assert.equal(regrown.data.projects.filter(x=>x.kind==='demo-replay').length,1);
});
