import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePages} from '../scripts/prepare-pages.mjs';
import {staticFiles} from '../scripts/static-export.mjs';
import {createStaticPreview} from '../scripts/serve.mjs';
const source=fileURLToPath(new URL('../dist/',import.meta.url));
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'manta-pages-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function fixture(root){await fs.mkdir(root);await fs.writeFile(path.join(root,'index.html'),'<meta property="og:image" content="assets/readme-cover.svg"></head>');}
test('Pages export preserves all recorded evidence bytes and adds project-specific metadata',async t=>{
 const temp=await temporary(t),output=path.join(temp,'export');preparePages({outputRoot:output,baseUrl:'https://example.github.io/Manta'});
 for(const f of staticFiles(source))if(f.relative!=='index.html')assert.deepEqual(await fs.readFile(path.join(output,f.relative)),await fs.readFile(f.absolute),f.relative);
 const html=await fs.readFile(path.join(output,'index.html'),'utf8');assert.match(html,/https:\/\/example.github.io\/Manta\/assets\/readme-cover.svg/);assert.match(html,/<link rel="canonical" href="https:\/\/example.github.io\/Manta\/">/);
 assert.deepEqual(await fs.readFile(path.join(output,'.nojekyll')),Buffer.alloc(0));
 assert(!staticFiles(output).some(f=>/^(?:server|node_modules|\.git|\.openai)\//.test(f.relative)));
});
test('export rejects linked or hidden source files before creating the output',async t=>{
 const temp=await temporary(t),root=path.join(temp,'source'),output=path.join(temp,'export');await fixture(root);
 const privateFile=path.join(temp,'private.txt');await fs.writeFile(privateFile,'private fixture');await fs.symlink(privateFile,path.join(root,'linked.txt'));
 assert.throws(()=>preparePages({sourceRoot:root,outputRoot:output,baseUrl:'https://example.github.io/Manta/'}),/regular files/);await assert.rejects(fs.stat(output),{code:'ENOENT'});await fs.unlink(path.join(root,'linked.txt'));
 await fs.link(privateFile,path.join(root,'hardlink.txt'));assert.throws(()=>staticFiles(root),/Hard links/);await fs.unlink(path.join(root,'hardlink.txt'));
 await fs.writeFile(path.join(root,'.env'),'PORT=4320');assert.throws(()=>staticFiles(root),/Hidden configuration/);
});
test('export does not replace an occupied output or accept credential-bearing base URLs',async t=>{
 const temp=await temporary(t),root=path.join(temp,'source'),output=path.join(temp,'export');await fixture(root);await fs.mkdir(output);await fs.writeFile(path.join(output,'keep.txt'),'keep');
 assert.throws(()=>preparePages({sourceRoot:root,outputRoot:output,baseUrl:'https://example.github.io/Manta/'}),/new or empty/);assert.equal(await fs.readFile(path.join(output,'keep.txt'),'utf8'),'keep');
 assert.throws(()=>preparePages({sourceRoot:root,outputRoot:path.join(temp,'new'),baseUrl:'https://name:password@example.invalid/'}),/without credentials/);
 assert.throws(()=>preparePages({sourceRoot:root,outputRoot:path.join(root,'nested'),baseUrl:'https://example.github.io/Manta/'}),/contain each other/);
});
test('the exported demo works at a Pages project prefix with documents and original CSV downloads',async t=>{
 const temp=await temporary(t),output=path.join(temp,'export');preparePages({outputRoot:output,baseUrl:'https://example.github.io/Manta/'});
 const server=createStaticPreview({root:output,basePath:'/Manta/'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const file of ['','app.js','styles.css','assets/demo-guide.md','assets/evidence/recording.json','assets/evidence/STFLowPower.stf.json','assets/evidence/baseline.csv','assets/evidence/corrected.csv']){const response=await fetch(base+'/Manta/'+file);assert.equal(response.status,200,file);assert((await response.arrayBuffer()).byteLength>0);}
 assert.equal((await fetch(base+'/app.js')).status,404);assert.equal((await fetch(base+'/Manta',{redirect:'manual'})).status,308);
 assert.equal((await fetch(base+'/Manta/%2e%2e%2fpackage.json')).status,404);assert.equal((await fetch(base+'/Manta/.env')).status,404);
});
