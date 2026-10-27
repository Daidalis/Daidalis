import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApprovalCard,approvalCommand} from '../public/approval-card.mjs';

const command='/bin/zsh -lc \'git ls-tree -r HEAD && git -C components/generic_adcs status --short && git -C components/generic_star_tracker status --short && git -C sims/truth_42_sim status --short\'';
const request={id:'approval-native',tool:'codex.commandExecution',args:{kind:'command',threadId:'private-transport-id',turnId:'turn-1',command,cwd:'/project/nos3',commandActions:[{type:'unknown',command}],native:true}};

test('Readable command card preserves exact command, one-time action IDs and a closed protocol inspector',()=>{
  const html=renderApprovalCard(request,{threadTitle:'姿态接口分析'});
  assert.match(html,/<h3[^>]*>运行命令<\/h3>/);assert.match(html,/Codex · 姿态接口分析/);assert.match(html,/工作目录/);assert.match(html,/\/project\/nos3/);assert.equal(approvalCommand(request),command);
  const [main,technical]=html.split('<details');assert.ok(!main.includes('private-transport-id'));assert.ok(technical.includes('private-transport-id'));assert.doesNotMatch(technical.split('>')[0],/\bopen\b/);
  assert.match(html,/data-action="approve-approval" data-id="approval-native">允许本次/);assert.match(html,/data-action="reject-approval" data-id="approval-native">拒绝/);assert.match(html,/data-action="copy-approval-command"/);
});

test('Approval content is escaped in command, reason, path, title context and diagnostic fields',()=>{
  const html=renderApprovalCard({id:'x" onclick="bad',tool:'Bash',args:{command:'echo <img src=x onerror=bad>',description:'<script>bad</script>',cwd:'<path>'}},{threadTitle:'<iframe>'});
  assert.doesNotMatch(html,/<script>|<img|<iframe>|data-id="x" onclick/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;path&gt;/);
});

test('File approvals show actual edits and project fallback is labeled as project folder',()=>{
  const html=renderApprovalCard({id:'edit',tool:'Edit',args:{file_path:'model.c',old_string:'old()',new_string:'new()'}},{projectFolder:'/workspace',technicalOpen:true,scope:'modal'});
  assert.match(html,/项目文件夹/);assert.doesNotMatch(html,/工作目录/);assert.match(html,/model.c/);assert.match(html,/替换前/);assert.match(html,/old\(\)/);assert.match(html,/替换后/);assert.match(html,/new\(\)/);assert.match(html,/data-approval-technical="edit" open/);assert.match(html,/id="approval-title-modal-edit"/);
});
