import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../server/store.mjs';

const exampleDir=fileURLToPath(new URL('../examples/electric-sedan',import.meta.url));
function fileURLToPath(url){return new URL(url).pathname;}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'daidalis-replay-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('the recorded sedan demo timeline is honest about what it references',async()=>{
  const replay=JSON.parse(await fs.readFile(path.join(exampleDir,'replay.json'),'utf8'));
  assert.equal(replay.schema,'daidalis-demo-replay-v1');
  assert.equal(replay.provenance,'curated');
  assert.match(replay.note,/真实求解/);
  assert.match(replay.note,/文件逐字节保留/);
  assert.ok(typeof replay.prompt==='string'&&replay.prompt.length>50);
  // the timeline follows the original session's full duration, in order
  assert.equal(replay.durationSeconds,5407);
  let previousT=0;
  for(const entry of replay.entries){assert.ok(Number.isFinite(entry.t)&&entry.t>=previousT,'entry t is ordered');previousT=entry.t;}
  assert.equal(previousT,replay.durationSeconds,'the last entry closes the session timeline');
  const kinds=new Set(replay.entries.map(entry=>entry.kind));
  assert.deepEqual([...kinds].sort(),['activity','message','modeling']);
  for(const [index,entry] of replay.entries.entries()){
    assert.ok(['message','activity','modeling'].includes(entry.kind),`entry ${index} has a known kind`);
    if(entry.kind==='modeling')assert.ok(entry.do&&['open','appearance','recorded','event'].includes(entry.do),`entry ${index} has a known modeling action`);
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
  const resolveExample=entryPath=>path.join(exampleDir,path.relative('sedan',entryPath));
  for(const entry of replay.entries)if(entry.kind==='modeling'&&entry.path)await fs.access(resolveExample(entry.path));
  // the conversation carries only the task; activity cards and assistant logs stay out
  const messages=replay.entries.filter(entry=>entry.kind==='message');
  assert.equal(messages.length,1,'the conversation shows only the task');
  assert.equal(messages[0].usePrompt,true,'that single message is the original task');
  assert.equal(replay.entries.filter(entry=>entry.kind==='activity').length,0,'no activity cards');
  // the shell assembles through the archived real save sequence, in part-count order
  const appearanceSteps=replay.entries.filter(entry=>entry.kind==='modeling'&&entry.do==='appearance');
  assert.equal(appearanceSteps.length,5,'the shell assembles through five archived saves');
  const partCounts=[];
  for(const step of appearanceSteps){
    const source=await fs.readFile(resolveExample(step.path),'utf8');
    partCounts.push(source.split('\n').filter(line=>/^\s*part \w/.test(line)).length);
  }
  for(let index=1;index<partCounts.length;index++)assert.ok(partCounts[index]>partCounts[index-1],`appearance save ${index+1} grows the shell (${partCounts.join(' → ')})`);
  assert.equal(partCounts.at(-1),Number((await fs.readFile(path.join(exampleDir,'ElectricSedan.appearance.sysml'),'utf8')).split('\n').filter(line=>/^\s*part \w/.test(line)).length),'the last step is the shipped final shell');
  // the retained artifacts the narrative claims are real
  const manifest=JSON.parse(await fs.readFile(path.join(exampleDir,'ElectricSedan.recorded.json'),'utf8'));
  assert.equal(manifest.provenance,'fmu-run');
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
  for(const name of ['replay.json','prompt.md','ElectricSedan.sysml','ElectricSedan.appearance.sysml','ElectricSedan.scad','ElectricSedan.stl','ElectricSedan.png','ElectricSedan.fmu','trajectory.csv','ElectricSedan.recorded.json','ElectricSedan.mo']){
    const copied=path.join(folder,'sedan',name),original=path.join(exampleDir,name);
    await fs.access(copied);
    assert.deepEqual(await fs.readFile(copied),await fs.readFile(original),`${name} is byte-identical`);
  }
  // the ordered model-version archive travels with the example
  const history=String(await fs.readFile(path.join(folder,'sedan','.daidalis','professional-model-history','index.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(history.length,11);
  for(let index=1;index<history.length;index++)assert.ok(history[index-1].savedAt<=history[index].savedAt,'the process index is in save order');
  for(const row of history)await fs.access(path.join(folder,'sedan','.daidalis','professional-model-history',row.sha256+path.extname(row.path)));
  await fs.access(path.join(folder,'replay.json'));
  // a persisted store does not seed twice
  const reopened=createStore({dataDir:path.join(root,'.local'),seed:true});
  assert.equal(reopened.data.projects.length,1);
});
