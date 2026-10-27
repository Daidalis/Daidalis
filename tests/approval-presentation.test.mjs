import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApprovalPresentation as present} from '../public/approval-presentation.mjs';

test('commands retain exact shell text and hide transport metadata from the summary',()=>{
  const command='/bin/zsh -lc \'git ls-tree -r HEAD && printf "%s\\n" "quoted value"\'\n# next line';
  const args={command,cwd:'/projects/nos3',reason:'检查当前工程基线',threadId:'native-thread',turnId:'turn',itemId:'item',startedAtMs:1,environmentId:'local',commandActions:[{type:'unknown'}],native:true};
  const before=JSON.stringify(args),v=present({tool:'codex.commandExecution',args});
  assert.equal(v.kind,'command');assert.equal(v.title,'运行命令');assert.equal(v.source,'Codex');
  assert.equal(v.command,command);assert.equal(v.commandFormat,'shell');assert.equal(v.cwd,args.cwd);assert.equal(v.reason,args.reason);
  assert.deepEqual(v.blocks,[]);assert.equal(JSON.stringify(args),before);
});

test('argv is serialized as an array without misleading shell joining',()=>{
  const command=['/bin/sh','-c','printf "%s" "$HOME"\ntrue','argument with spaces','&&'];
  const v=present({tool:'codex.commandExecution',args:{command}});
  assert.equal(v.commandFormat,'argv');assert.deepEqual(JSON.parse(v.command),command);
});

test('Claude Bash and project command parameters are readable and complete',()=>{
  const bash=present({tool:'Bash',args:{command:'cat "a b" && echo done',description:'查看文件',timeout:5000,run_in_background:false}});
  assert.equal(bash.source,'Claude Code');assert.equal(bash.reason,'查看文件');assert.equal(bash.command,'cat "a b" && echo done');
  assert.deepEqual(bash.fields,[{label:'超时（毫秒）',value:'5000'}]);assert.equal(JSON.parse(bash.blocks[0].content).run_in_background,false);
  assert.equal(present({tool:'run_command',args:{command:'pwd'}}).source,'Manta');
});

test('Codex file changes preserve exact paths, kinds, moves and diff',()=>{
  const diff='@@ -1 +1 @@\n-old\n+new';
  const v=present({tool:'codex.fileChange',args:{threadId:'transport',changes:[
    {path:'design.md',kind:{type:'add'},diff:'+ plan'},
    {path:'before.c',kind:{type:'update',move_path:'after.c'},diff},
    {path:'obsolete.c',kind:{type:'delete'},diff:'- removed'},
    {path:'strange.bin',kind:{type:'future-kind',explanation:'preserved'},diff:'opaque'},
  ]}});
  assert.equal(v.kind,'files');assert.equal(v.source,'Codex');assert.ok(v.fields.some(f=>f.label==='新增文件'&&f.value==='design.md'));
  assert.ok(v.fields.some(f=>f.label==='移动到'&&f.value==='after.c'));assert.ok(v.fields.some(f=>f.label==='删除文件'));
  assert.ok(v.fields.some(f=>f.label==='变更类型'&&f.value==='future-kind'));assert.ok(v.blocks.some(b=>b.content===diff&&b.format==='diff'));
  assert.ok(v.blocks.some(b=>b.content.includes('preserved')));assert.ok(!JSON.stringify(v).includes('transport'));
});

test('Claude Edit previews before/after without fabricating a diff; writes retain empty content',()=>{
  const v=present({tool:'Edit',args:{file_path:'x.c',old_string:'a\nb',new_string:'c\nd',replace_all:false}});
  assert.equal(v.source,'Claude Code');assert.deepEqual(v.blocks,[{label:'替换前',content:'a\nb',format:'text'},{label:'替换后',content:'c\nd',format:'text'}]);
  assert.ok(v.fields.some(f=>f.label==='替换所有匹配'&&f.value==='否'));
  for(const tool of ['Write','write_file']){
    const written=present({tool,args:{path:'empty.txt',content:''}});assert.equal(written.kind,'files');assert.equal(written.blocks[0].content,'');
  }
});

test('desktop/browser payloads support flattened and nested schemas without losing action semantics',()=>{
  for(const args of [{action:'browser.type',text:'hello',screenVersion:4},{action:'browser.type',args:{text:'hello',screenVersion:4}}]){
    const v=present({tool:'computer_use',args});assert.equal(v.title,'在网页输入文字');assert.ok(v.blocks.some(b=>b.label==='输入文字'&&b.content==='hello'));
    assert.ok(v.blocks.some(b=>b.content.includes('screenVersion')));
  }
  const v=present({tool:'computer_use',args:{action:'desktop.click',x:0,y:0}});assert.ok(v.fields.some(f=>f.label==='X 坐标'&&f.value==='0'));
});

test('model counts supplement the complete proposed model, including stable IDs and zero values',()=>{
  const args={version:0,nodes:[{id:'R-1',type:'requirement',text:'retain'}],links:[]};
  const v=present({tool:'update_model',args});assert.ok(v.fields.some(f=>f.label==='模型版本'&&f.value==='0'));
  assert.ok(v.fields.some(f=>f.label==='模型关联'&&f.value==='0'));assert.deepEqual(JSON.parse(v.blocks[0].content),args);
});

test('unknown tools retain semantic arguments, including thread IDs and metadata-like names',()=>{
  const args={threadId:'target-worker',turnId:'semantic-user-value',native:'semantic',commandActions:['do not drop'],custom:{x:1}};
  const v=present({tool:'custom_operation',args});assert.equal(v.title,'使用工具');assert.equal(v.source,'Manta');
  assert.deepEqual(JSON.parse(v.blocks[0].content),args);
  const steer=present({tool:'steer_thread',args:{threadId:'target-worker',content:'do this',providerId:'codex-local'}});
  assert.ok(steer.fields.some(f=>f.label==='子线程'&&f.value==='target-worker'));
  assert.deepEqual(JSON.parse(steer.blocks[0].content),{content:'do this',providerId:'codex-local'});
});

test('hostile strings remain plain data and are neither interpreted nor silently changed',()=>{
  const hostile='<img src=x onerror="alert(1)">\n$(touch /tmp/unwanted) && `id`';
  const v=present({tool:'Write',args:{file_path:hostile,content:hostile}});
  assert.equal(v.fields[0].value,hostile);assert.equal(v.blocks[0].content,hostile);
  assert.equal(present({tool:hostile,args:{value:hostile}}).fields[0].value,hostile);
  assert.equal(JSON.parse(present({tool:'unknown',args:{value:hostile}}).blocks[0].content).value,hostile);
});

test('absent and malformed payloads use stable empty defaults with inspectable fallback',()=>{
  assert.deepEqual(present(),{kind:'tool',title:'使用工具',source:'Manta',reason:'',cwd:'',command:'',commandFormat:'shell',fields:[],blocks:[]});
  assert.equal(present(null).kind,'tool');assert.equal(present({tool:'unknown',args:'raw payload'}).blocks[0].content,'raw payload');
  assert.deepEqual(JSON.parse(present({tool:'codex.fileChange',args:{changes:{unexpected:true}}}).blocks[0].content),{unexpected:true});
});


test('Native command envelope decisions and suggested policy stay in diagnostics, not the action summary',()=>{
  const args={kind:'command',command:'git status --short',cwd:'/project',threadId:'native-id',turnId:'turn',itemId:'item',startedAtMs:12,environmentId:'local',commandActions:[{type:'unknown'}],proposedExecpolicyAmendment:['git'],availableDecisions:['accept','cancel'],native:true};
  const view=present({tool:'codex.commandExecution',args});assert.equal(view.command,args.command);assert.equal(view.cwd,args.cwd);assert.deepEqual(view.blocks,[]);assert.deepEqual(view.fields,[]);
});
