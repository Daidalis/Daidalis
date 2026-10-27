import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const DEFAULT_SETTINGS=Object.freeze({defaultPermissionMode:'manual',appearance:'system'});
const ALLOWED=Object.freeze({defaultPermissionMode:['manual','auto'],appearance:['system','light','dark']});

function invalid(message){const error=new Error(message);error.status=400;error.code='INVALID_SETTINGS';return error;}
function persistenceError(message,cause){const error=new Error(message,{cause});error.status=500;error.code='SETTINGS_PERSISTENCE_ERROR';return error;}

export function validateSettingsPatch(input,{allowEmpty=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw invalid('Settings must be a JSON object');
  const keys=Object.keys(input);
  if(!allowEmpty&&!keys.length)throw invalid('Settings update must contain at least one supported field');
  const result={};
  for(const key of keys){
    if(!Object.hasOwn(ALLOWED,key))throw invalid(`Unknown setting: ${key}`);
    if(typeof input[key]!=='string'||!ALLOWED[key].includes(input[key]))throw invalid(`${key} must be ${ALLOWED[key].join(' or ')}`);
    result[key]=input[key];
  }
  return result;
}

export async function createSettingsService({dataDir}={}){
  if(typeof dataDir!=='string'||!dataDir.length)throw new Error('Settings dataDir is required');
  await fs.mkdir(dataDir,{recursive:true,mode:0o700});
  const file=path.join(dataDir,'settings.json');
  let state=Object.freeze({...DEFAULT_SETTINGS}),queue=Promise.resolve();
  async function safeExisting(){
    try{
      const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw persistenceError('settings.json must be a regular file of at most 16 KiB; preserve it and repair it before restarting');
      return stat;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function persist(next){
    await safeExisting();
    const temporary=path.join(dataDir,`.settings-${randomUUID()}.tmp`);
    let handle;
    try{
      handle=await fs.open(temporary,'wx',0o600);
      await handle.writeFile(JSON.stringify(next,null,2)+'\n','utf8');
      await handle.sync();await handle.close();handle=null;
      await fs.rename(temporary,file);
    }catch(error){throw persistenceError('Could not save global settings; previous settings remain unchanged',error);}
    finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});}
  }
  const existing=await safeExisting();
  if(existing){
    try{state=Object.freeze({...DEFAULT_SETTINGS,...validateSettingsPatch(JSON.parse(await fs.readFile(file,'utf8')),{allowEmpty:true})});}
    catch(error){throw persistenceError('settings.json is unreadable or invalid; preserve it and repair it before restarting',error);}
    // Replace through the same private temporary file instead of chmod following a raced symlink.
    await persist(state);
  }else await persist(state);
  return {
    get(){return {...state};},
    async patch(input){
      const changes=validateSettingsPatch(input);
      const operation=queue.then(async()=>{
        const next=Object.freeze({...state,...changes});
        await persist(next);state=next;
        return {...state};
      });
      queue=operation.catch(()=>{});
      return operation;
    }
  };
}
