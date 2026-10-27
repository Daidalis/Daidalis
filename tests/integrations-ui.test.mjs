import test from 'node:test';
import assert from 'node:assert/strict';
import {renderIntegrations,renderConnectorForm,parseConnectorForm,renderWorkerForm,renderToolCatalog,renderJobResult} from '../public/integrations-ui.mjs';

test('engineering connection view distinguishes model semantics, worker configuration and actual job scope',()=>{
  const html=renderIntegrations({project:{id:'p',name:'NOS3'},projects:[{id:'p',name:'NOS3'}],status:'ready',data:{modelBackend:{backend:{name:'Open-MBEE SysML v2',version:'0.54.0',available:true,isolated:true}},connectors:[{id:'m',name:'MCP server',url:'https://example.org/mcp',transport:'http',enabled:false,status:'connected'}],nos3:{revision:'abc123',worker:{configured:false}},jobs:[{id:'job',scope:'component',status:'completed',manifestPath:'evidence/manifest.json'}]}});
  assert.match(html,/连接仅用于所选项目/);assert.match(html,/Open-MBEE SysML v2/);assert.match(html,/工程行为由相应仿真工具执行/);assert.match(html,/已停用/);assert.match(html,/组件验证/);assert.match(html,/已保存证据清单/);assert.doesNotMatch(html,/data-action="(?:submit|run|prepare|generate)/);
});

test('connector configuration submits credentials separately, never converts unknown tool metadata into authority',()=>{
  const {config,runtimeKey}=parseConnectorForm({name:'Tool',transport:'http',url:'https://example.org/mcp',enabled:'on',runtimeKey:'entered-secret',toolPolicies:'{"inspect":"read"}'});
  assert.equal(config.enabled,true);assert.equal(runtimeKey,'entered-secret');assert.ok(!JSON.stringify(config).includes('entered-secret'));
  const html=renderToolCatalog([{name:'claimed_safe',effect:'write',policyConfigured:false,annotations:{readOnlyHint:true},inputSchema:{type:'object'}}]);
  assert.match(html,/需要批准 · 未配置权限/);assert.doesNotMatch(html,/>读取</);
  assert.throws(()=>parseConnectorForm({name:'x',transport:'stdio',command:'npx',args:'[]',toolPolicies:'{}'}),/绝对路径/);
  assert.throws(()=>parseConnectorForm({name:'x',transport:'stdio',command:'/server',args:'{"wrong":true}',toolPolicies:'{}'}),/字符串 JSON 数组/);
  assert.throws(()=>parseConnectorForm({name:'x',transport:'http',url:'https://example.org',toolPolicies:'{"inspect":"allow-all"}'}),/read、write 或 run/);
});

test('external connector, catalog, job and project values cannot inject markup or action attributes',()=>{
  const attack='x"><img src=x onerror="bad()">';
  const html=[renderConnectorForm({id:attack,name:attack,url:attack,toolPolicies:{[attack]:'read'}},attack),renderWorkerForm({endpoint:attack},attack),renderToolCatalog([{name:attack,description:attack,inputSchema:{description:attack}}]),renderJobResult({id:attack,status:attack,scope:'component'},{ready:true,reason:attack,checks:[{id:attack,passed:false,criterion:attack}]})].join('');
  assert.doesNotMatch(html,/<img|onerror="bad\(\)"|data-id="x">/);assert.match(html,/&lt;img/);
  assert.match(renderJobResult({id:'j',status:'completed',scope:'component'},{ready:true}),/未执行完整 NOS3\/cFS\/42 集成仿真/);
});

test('project switch, loading failures and incomplete jobs display truthful states',()=>{
  assert.match(renderIntegrations({project:null,status:'idle'}),/先选择项目/);
  assert.match(renderIntegrations({project:{name:'Other'},status:'loading'}),/正在读取项目连接/);
  const failed=renderIntegrations({project:{name:'P'},status:'error',error:'service unavailable'});assert.match(failed,/role="alert"/);assert.match(failed,/重试/);assert.doesNotMatch(failed,/尚未添加 MCP/);
  const waiting=renderJobResult({id:'j',status:'running',scope:'integration'},{ready:false});assert.match(waiting,/作业尚未结束/);assert.doesNotMatch(waiting,/通过/);
});

test('successful component checks keep unverified requirements visible beside their actual reasons',()=>{
  const html=renderJobResult({id:'job',status:'completed',scope:'component'},{ready:true,passed:true,checks:[{id:'V-ROTATION',passed:true,criterion:'Component rotation only'}],pendingRequirements:[{id:'R-SENSOR-SEPARATION',status:'not-tested',reason:'Telemetry parsing was not executed.'},{id:'R-INTEGRATION',status:'blocked',reason:'No configured remote Worker.'}]});
  const visible=html.split('<details')[0];
  assert.match(visible,/尚未验证的需求/);assert.match(visible,/R-SENSOR-SEPARATION · 未验证/);assert.match(visible,/Telemetry parsing was not executed\./);assert.match(visible,/R-INTEGRATION · 受阻/);assert.match(visible,/No configured remote Worker\./);assert.match(visible,/未执行完整 NOS3\/cFS\/42 集成仿真/);
  const escaped=renderJobResult({id:'job',status:'blocked',scope:'integration'},{ready:true,reason:'Worker unavailable',pendingRequirements:[{id:'<img src=x>',reason:'<script>bad()</script>'}]});assert.doesNotMatch(escaped,/<img|<script>/);assert.match(escaped,/&lt;img/);assert.match(escaped,/Worker unavailable/);
});
