import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const require=createRequire(import.meta.url);
const APPLE_SCRIPTS={
  click:'on run argv\nset px to item 1 of argv as integer\nset py to item 2 of argv as integer\ntell application "System Events" to click at {px, py}\nend run',
  type:'on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run',
  key:'on run argv\nset keynum to item 1 of argv as integer\ntell application "System Events" to key code keynum\nend run'
};
const KEYCODES={Enter:36,Tab:48,Escape:53,Backspace:51,Delete:117,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126,Space:49};

function exec(program,args,timeout=12000){return new Promise((resolve,reject)=>{const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});let output='',error='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Computer action timed out'));},timeout);child.stdout.on('data',d=>output+=d.toString().slice(0,10000));child.stderr.on('data',d=>error+=d.toString().slice(0,10000));child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(error||`Computer driver exited ${code}`));});});}
function assertNumber(v,name,min,max){if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${name} must be between ${min} and ${max}`);return v;}
function remoteHostAllowed(host,allowed){return allowed.some(d=>host===d||host.endsWith('.'+d));}
const ENGINEERING_STATIC=new Set(['/engineering.html','/engineering.js','/engineering.css']);
const ENGINEERING_API=/^\/api\/engineering\/(catalog|run|runs(?:\/[a-zA-Z0-9_-]+)?|outputs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)$/;
export function validateBrowserUrl(value,{baseUrl,allowedHosts=[],projectId}={}){
  const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Only ordinary HTTP(S) pages are allowed');
  const base=new URL(baseUrl);
  if(url.origin===base.origin){
    if(['/computer-fixture.html','/computer-fixture.js'].includes(url.pathname)&&!url.search)return url.href;
    const engineering=ENGINEERING_STATIC.has(url.pathname)||ENGINEERING_API.test(url.pathname);
    if(engineering){
      const keys=[...url.searchParams.keys()];if(keys.some(k=>k!=='projectId'))throw new Error('Unsupported engineering page query');
      const selected=url.searchParams.get('projectId');
      if(selected&&(!/^[a-zA-Z0-9_-]+$/.test(selected)||(projectId&&selected!==projectId)))throw new Error('Engineering browser project does not match its session');
      if(url.pathname==='/engineering.html'&&!selected)throw new Error('Engineering page needs its projectId');
      return url.href;
    }
    throw new Error('The isolated browser cannot access the Studio application or its approval API');
  }
  if(url.protocol!=='https:'||(url.port&&url.port!=='443')||!remoteHostAllowed(url.hostname,allowedHosts))throw new Error('This host is not in the computer allowlist. Configure MBSE_COMPUTER_HOSTS on the server.');return url.href;
}
export function validateBrowserRequest(value,{baseUrl,allowedHosts=[],projectId,method='GET',body}={}){
  const href=validateBrowserUrl(value,{baseUrl,allowedHosts,projectId}),url=new URL(href);
  if(url.origin===new URL(baseUrl).origin&&url.pathname.startsWith('/api/engineering/')){
    if(url.pathname==='/api/engineering/run'){
      if(method!=='POST')throw new Error('Engineering execution uses POST');
      let payload;try{payload=JSON.parse(body||'{}');}catch{throw new Error('Invalid engineering request');}
      if(!projectId||payload.projectId!==projectId)throw new Error('Engineering run must remain in its browser project');
    }else{
      if(method!=='GET')throw new Error('Engineering browser only permits read operations here');
      if(url.pathname!=='/api/engineering/catalog'&&url.searchParams.get('projectId')!==projectId)throw new Error('Engineering result must remain in its browser project');
    }
  }
  return href;
}
export function browserActionNeedsApproval({action,source,permissionMode,baseUrl,currentUrl,targetUrl}={}){
  if(source==='user'||['browser.start','browser.screenshot'].includes(action))return false;
  const origin=new URL(baseUrl).origin;
  const local=new URL(action==='browser.navigate'?targetUrl:currentUrl).origin===origin;
  return permissionMode!=='auto'||!local;
}
const DESKTOP_TOOL_NAMES=[['omedit',/^(OMEdit|OpenModelica)(?:[-_ \d.]*)\.app$/i],['capella',/^Capella(?:[-_ \d.]*)\.app$/i],['papyrus',/^Papyrus(?:[-_ \d.]*)\.app$/i],['matlab',/^MATLAB(?:[_ -]R?\d{4}[ab])?\.app$/i],['dymola',/^Dymola(?:[-_ \d.]*)\.app$/i],['amesim',/^Amesim(?:[-_ \d.]*)\.app$/i],['scilab',/^Scilab(?:[-_ \d.]*)\.app$/i],['freecad',/^FreeCAD(?:[-_ \d.]*)\.app$/i]];
async function desktopTools(){let names=[];try{names=await fs.readdir('/Applications');}catch{}return DESKTOP_TOOL_NAMES.map(([id,re])=>{const name=names.find(n=>re.test(n));return{id,name:name||id,installed:!!name,path:name?path.join('/Applications',name):null};});}

async function loadPlaywright(){for(const spec of ['playwright',...(process.env.MBSE_NODE_MODULES?[path.join(process.env.MBSE_NODE_MODULES,'playwright')]:[])]){try{return require(spec);}catch{}}return null;}

export async function createComputerService({root,dataDir,workspacesDir,requestApproval=async()=>false,emit=()=>{}}={}){
  const shots=path.join(dataDir||path.join(root,'.local'),'computer-screenshots');await fs.mkdir(shots,{recursive:true});
  const playwright=await loadPlaywright();let appTools=await desktopTools();let engineeringAvailable=false;try{await fs.access(path.join(root,'public/engineering.html'));engineeringAvailable=true;}catch{}let browser;let desktopEnabled=false;const sessions=new Map(),locks=new Map();
  const allowedHosts=(process.env.MBSE_COMPUTER_HOSTS||'docs.px4.io,github.com,raw.githubusercontent.com,nos3.readthedocs.io,emanual.robotis.com,bitcraze.io,www.bitcraze.io,example.com').split(',').map(s=>s.trim()).filter(Boolean);
  let baseUrl=process.env.MBSE_BASE_URL||`http://127.0.0.1:${process.env.PORT||4317}`;
  const validNavigation=(value,projectId)=>validateBrowserUrl(value,{baseUrl,allowedHosts,projectId});
  async function ensureBrowser(){if(!playwright)throw new Error('Playwright unavailable. Install optional dependencies with npm install.');if(!browser){const opts={headless:process.env.MBSE_BROWSER_VISIBLE!=='1',args:['--disable-extensions','--disable-background-networking']};if(process.env.MBSE_CHROME_PATH)opts.executablePath=process.env.MBSE_CHROME_PATH;else if(os.platform()==='darwin')opts.channel='chrome';try{browser=await playwright.chromium.launch(opts);}catch(e){throw new Error('Isolated browser could not start. Install Chrome or run npx playwright install chromium. '+e.message.slice(0,180));}}return browser;}
  async function session(projectId){if(!projectId||!/^[a-zA-Z0-9_-]+$/.test(projectId))throw new Error('A valid projectId is required');if(!sessions.has(projectId)){const b=await ensureBrowser();const context=await b.newContext({viewport:{width:1120,height:760},acceptDownloads:false,serviceWorkers:'block'});await context.route('**/*',async route=>{try{const u=new URL(route.request().url());if(!['http:','https:'].includes(u.protocol))return route.abort();validateBrowserRequest(u.href,{baseUrl,allowedHosts,projectId,method:route.request().method(),body:route.request().postData()});await route.continue();}catch{await route.abort();}});if(typeof context.routeWebSocket==='function')await context.routeWebSocket('**/*',ws=>ws.close());const page=await context.newPage();sessions.set(projectId,{context,page,version:0});context.on('page',p=>{if(sessions.get(projectId)?.page!==p)p.close().catch(()=>{});});await page.goto(engineeringAvailable?baseUrl+'/engineering.html?projectId='+encodeURIComponent(projectId):baseUrl+'/computer-fixture.html',{waitUntil:'domcontentloaded',timeout:15000});}return sessions.get(projectId);}
  async function snapshot(s){const name=crypto.randomUUID()+'.png',file=path.join(shots,name);await s.page.screenshot({path:file,type:'png',timeout:12000});return {imageUrl:'/api/computer/screenshots/'+name,url:s.page.url(),width:1120,height:760,screenVersion:s.version,text:(await s.page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,16000)};}
  async function approve(payload,ctx){if(ctx.source==='user')return true;return !!(await requestApproval({runId:ctx.runId,projectId:payload.projectId,tool:'computer_use',args:{action:payload.action,...payload.args},signal:ctx.signal}));}
  async function innerAction(payload,ctx={}){const {projectId,action,args={}}=payload;if(ctx.signal?.aborted)throw new Error('Cancelled');emit({projectId,runId:ctx.runId,type:'computer.action',message:action,data:{action,args:{...args,text:args.text?String(args.text).slice(0,120):undefined}}});
    if(action==='desktop.enable'){if(ctx.source!=='user'||args.consent!==true)throw new Error('Desktop access requires explicit user consent in the app');desktopEnabled=true;return {ok:true,message:'Desktop bridge enabled for this server session. macOS may still require Screen Recording and Accessibility permissions.'};}
    if(action==='desktop.disable'){desktopEnabled=false;return {ok:true};}
    if(action==='desktop.apps'){appTools=await desktopTools();return {tools:appTools,detection:'Known application names in /Applications only; launch, license and model compatibility are not verified.'};}
    if(action.startsWith('desktop.')){if(os.platform()!=='darwin')throw new Error('Native desktop bridge currently supports macOS. Use the isolated browser on this platform.');if(!desktopEnabled)throw new Error('Enable desktop access with explicit consent first');if(!await approve(payload,ctx))throw new Error('Desktop action rejected');
      if(action==='desktop.open_app'){appTools=await desktopTools();const tool=appTools.find(t=>t.id===args.toolId&&t.installed);if(!tool)throw new Error('Selected engineering application is not installed');await exec('/usr/bin/open',['-a',tool.path]);return {ok:true,toolId:tool.id,name:tool.name,scope:'native-desktop'};}
      if(action==='desktop.screenshot'){const name=crypto.randomUUID()+'.png';try{await exec('/usr/sbin/screencapture',['-x','-m','-t','png',path.join(shots,name)]);}catch(e){throw new Error('Screen Recording permission may be required in macOS System Settings. '+e.message);}const geometry=JSON.parse(await exec('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("CoreGraphics"); var b=$.CGDisplayBounds($.CGMainDisplayID()); JSON.stringify(b);']));const png=await fs.readFile(path.join(shots,name));const pixelWidth=png.readUInt32BE(16),pixelHeight=png.readUInt32BE(20);return {ok:true,imageUrl:'/api/computer/screenshots/'+name,width:geometry.size.width,height:geometry.size.height,pixelWidth,pixelHeight,coordinateSpace:'main-display-logical-points',scope:'native-desktop',message:'Main display only. Click coordinates use logical points; screenshot pixels may be scaled by Retina. Driver permission has been exercised.'};}
      if(action==='desktop.click'){const x=assertNumber(args.x,'x',0,20000),y=assertNumber(args.y,'y',0,20000);await exec('/usr/bin/osascript',['-e',APPLE_SCRIPTS.click,String(Math.round(x)),String(Math.round(y))]);return {ok:true};}
      if(action==='desktop.type'){const text=String(args.text||'');if(text.length>4000)throw new Error('Text too long');await exec('/usr/bin/osascript',['-e',APPLE_SCRIPTS.type,text]);return {ok:true};}
      if(action==='desktop.key'){if(!Object.hasOwn(KEYCODES,args.key))throw new Error('Unsupported native key');await exec('/usr/bin/osascript',['-e',APPLE_SCRIPTS.key,String(KEYCODES[args.key])]);return {ok:true};}
      throw new Error('Unsupported desktop action');
    }
    if(!action.startsWith('browser.'))throw new Error('Unknown computer action');if(action==='browser.engineering'){payload={...payload,action:'browser.navigate',args:{...args,screenVersion:args.screenVersion??sessions.get(projectId)?.version??0,url:baseUrl+'/engineering.html?projectId='+encodeURIComponent(projectId)}};return innerAction(payload,ctx);}if(action==='browser.navigate')validNavigation(args.url,projectId);const s=await session(projectId);const mutating=!['browser.screenshot','browser.start'].includes(action);
    if(mutating&&ctx.source!=='user'&&args.screenVersion!==s.version)throw new Error('Stale or missing screenVersion. Take a screenshot and use its screenVersion before acting.');
    if(mutating&&browserActionNeedsApproval({action,source:ctx.source,permissionMode:ctx.permissionMode,baseUrl,currentUrl:s.page.url(),targetUrl:args.url})&&!await approve(payload,ctx))throw new Error('Browser action rejected');
    if(action==='browser.navigate'){const url=validNavigation(args.url,projectId);await s.page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}
    else if(action==='browser.click'){await s.page.mouse.click(assertNumber(args.x,'x',0,1119),assertNumber(args.y,'y',0,759));}
    else if(action==='browser.type'){const text=String(args.text||'');if(text.length>12000)throw new Error('Text too long');await s.page.keyboard.insertText(text);}
    else if(action==='browser.key'){const key=String(args.key||'');if(!/^(Enter|Tab|Escape|Backspace|Delete|Arrow(Up|Down|Left|Right)|Space|Home|End|PageUp|PageDown|Control\+(a|Home|End)|Meta\+(a|ArrowUp|ArrowDown))$/.test(key))throw new Error('Unsupported browser key');await s.page.keyboard.press(key);await s.page.waitForTimeout(180);}
    else if(action==='browser.scroll'){
      const explicit=args.deltaX!==undefined||args.deltaY!==undefined;
      const dx=assertNumber(explicit?args.deltaX??0:args.x??0,'horizontal scroll',-3000,3000),dy=assertNumber(explicit?args.deltaY??0:args.y??500,'vertical scroll',-3000,3000);
      if(explicit&&(args.x!==undefined||args.y!==undefined))await s.page.mouse.move(assertNumber(args.x??560,'x',0,1119),assertNumber(args.y??380,'y',0,759));
      await s.page.mouse.wheel(dx,dy);await s.page.waitForTimeout(220);
    }
    else if(!['browser.screenshot','browser.start'].includes(action))throw new Error('Unsupported browser action');
    if(mutating)s.version++;return {ok:true,...await snapshot(s),scope:'isolated-browser'};
  }
  return {
    setBaseUrl(value){if(sessions.size)throw new Error('Cannot change computer origin with active sessions');const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Computer fixture must use the local app origin');baseUrl=u.origin;},
    status(){return {browser:{available:!!playwright,status:browser?'running':playwright?'ready':'missing-dependency',sessions:sessions.size,width:1120,height:760},desktop:{available:os.platform()==='darwin',status:desktopEnabled?'enabled-permissions-not-verified':'requires-consent',requiresPermissions:true,tools:appTools},engineeringUrl:baseUrl+'/engineering.html',allowedHosts,defaultUrl:engineeringAvailable?baseUrl+'/engineering.html':baseUrl+'/computer-fixture.html',notes:['Browser uses a fresh isolated context without account cookies.','Native desktop requires explicit session consent and macOS OS permissions.']};},
    async action(payload,ctx={}){const key=payload.projectId||'desktop';const prev=locks.get(key)||Promise.resolve();const next=prev.catch(()=>{}).then(()=>innerAction(payload,ctx));locks.set(key,next);try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}},
    async readScreenshot(name){if(!/^[a-f0-9-]+\.png$/.test(name))throw new Error('Invalid screenshot');const buffer=await fs.readFile(path.join(shots,name));return {buffer,contentType:'image/png'};},
    async close(){for(const s of sessions.values())await s.context.close().catch(()=>{});sessions.clear();await browser?.close().catch(()=>{});browser=undefined;}
  };
}
