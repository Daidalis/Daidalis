import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOL_DEFINITIONS,createToolRuntime} from '../server/tools.mjs';
import {ENGINEERING_ENTRY_GUIDANCE} from '../server/engineering-entry-guidance.mjs';
import {createStfCaseService} from '../server/stf-case.mjs';

test('a fresh native Agent cannot import the evaluator STF design through its Manta tool bridge',async()=>{
  const names=new Set(TOOL_DEFINITIONS.map(tool=>tool.name));
  assert.equal(names.has('stf_case_catalog'),false);
  assert.equal(names.has('create_stf_case'),false);
  assert.equal(names.has('professional_catalog'),true);
  assert.equal(names.has('submit_professional_job'),true);

  const runtime=createToolRuntime({store:{workspace:()=>'/unused/fresh-project'}});
  for(const name of ['stf_case_catalog','create_stf_case'])
    await assert.rejects(runtime.execute(name,{}, {projectId:'fresh-project'}),/Unknown tool/);

  // An explicit user action may still open the example catalog outside the Agent bridge.
  const reference=createStfCaseService({assetsRoot:'/unused/evaluator-only/reference'});
  assert.equal(reference.catalog().cases.length,2);
});

test('default engineering instructions do not seed an STF solution or source-first task wording',()=>{
  assert.doesNotMatch(ENGINEERING_ENTRY_GUIDANCE,/STF|基于这些资料开发/);
  assert.match(ENGINEERING_ENTRY_GUIDANCE,/natural-language system goal/);
  assert.match(ENGINEERING_ENTRY_GUIDANCE,/Threads cannot create another layer/);
});
