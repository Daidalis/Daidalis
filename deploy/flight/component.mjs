import fs from 'node:fs/promises';
import path from 'node:path';
import {executeComponent} from '../../server/nos3/core.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input),dir=process.argv[2];
const result=await executeComponent({workspace:'/srv/manta/source/nos3',dir,baseline:request.baseline,compilerPath:'/usr/bin/gcc',readSource:(_root,component,file)=>fs.readFile(path.join('/srv/manta/source/nos3',component.path,file))});
await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({...result,schema:'manta-nos3-verification-v1',scope:'component',telemetryFiles:[]},null,2));
console.log(JSON.stringify({status:result.status,passed:result.passed,reason:result.reason}));
process.exitCode=result.passed?0:1;
