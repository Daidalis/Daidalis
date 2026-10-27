import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEvaluator} from '../server/evaluator.mjs';
test('artifact deliveries are read by name and actual trace relations are required',async t=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'mbse-evaluation-'));
 t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
 const graph={nodes:[{id:'R1',type:'requirement'},{id:'T1',type:'test'}],links:[{source:'T1',target:'R1',type:'verifies'}]};
 const contents={'requirements.md':'A sourced interface requirement awaiting upstream reproduction.','model.json':JSON.stringify(graph),'verification.json':JSON.stringify({tests:[{id:'T1',status:'not-run'}]}),'change.md':'Proposed interface analysis. Not an upstream executable patch.'};
 const artifacts=[];await fs.mkdir(path.join(workspace,'artifacts'));
 for(const [name,content]of Object.entries(contents)){const file=path.join('artifacts','stored-'+name);await fs.writeFile(path.join(workspace,file),content);artifacts.push({name,path:file,projectId:'project_test',createdAt:new Date().toISOString()});}
 const evaluator=await createEvaluator({root:workspace,dataDir:path.join(workspace,'data'),store:{workspace:()=>workspace,data:{artifacts}}});
 const complete=await evaluator.evaluate({taskId:'nos3-351',projectId:'project_test'});
 assert.equal(complete.status,'evidence-complete');assert.equal(complete.engineeringStatus,'not-evaluated');assert.equal(complete.upstreamReproduction,false);
 graph.links=[];await fs.writeFile(path.join(workspace,'artifacts/stored-model.json'),JSON.stringify(graph));
 const disconnected=await evaluator.evaluate({taskId:'nos3-351',projectId:'project_test'});
 assert.equal(disconnected.status,'incomplete');assert.equal(disconnected.checks.find(c=>c.id==='model-trace').passed,false);
 await assert.rejects(evaluator.evaluate({taskId:'px4-6488',projectId:'project_test',submission:{kind:'quaternion-interface-v1'}}),/restricted/);
});
