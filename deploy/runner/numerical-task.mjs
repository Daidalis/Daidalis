import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createEngineeringService} from '../../server/engineering.mjs';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>64000)throw Error('Numerical request too large');}
const input=JSON.parse(raw),mode=process.argv[2];
await fs.mkdir('/work/project',{recursive:true});
const service=await createEngineeringService({root:'/opt/manta',dataDir:'/tmp/numerical-state',store:{workspace:()=>'/work/project',add:()=>{}}});
if(mode==='status'){
 const status=await service.recheckRuntime();
 console.log(JSON.stringify({code:status.available?0:1,stdout:JSON.stringify(status.versions||{}),stderr:status.diagnostic||status.detail}));
}else if(mode==='run'){
 if(!input||Object.keys(input).some(k=>!['parameters','scan'].includes(k)))throw Error('Invalid numerical inputs');
 const report=await service.run({...input,projectId:'isolated'}),files=[];
 for(const name of ['result.json','series.csv','temperature.svg']){const {buffer}=await service.readOutput(report.id,name,{projectId:'isolated'});files.push({name,contentBase64:buffer.toString('base64'),sha256:createHash('sha256').update(buffer).digest('hex')});}
 console.log(JSON.stringify({files}));
}else throw Error('Unsupported numerical operation');
