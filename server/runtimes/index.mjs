import fs from 'node:fs';
import path from 'node:path';
import {createCodexRuntime} from './codex.mjs';
import {createClaudeRuntime} from './claude.mjs';
import {createSdkRuntime} from './sdk.mjs';

export function runtimeName(profile) {
  if (['codex-app-server','codex-cli'].includes(profile.type)) return 'codex-app-server';
  if (profile.type==='claude-agent') return 'claude-agent-sdk';
  return 'openai-agents-sdk';
}
export function createRuntimeManager({providers,dataDir,codexPath,codexReadIsolation,codexRemoteWorkspace,claudeRemoteWorkspace,requireClaudeRemoteWorkspace=false,adapters={}}) {
  const instances=new Map();
  function instance(name) {
    if(instances.has(name))return instances.get(name);
    const supplied=adapters[name];
    const value=supplied||(name==='codex-app-server'?createCodexRuntime({codexPath,readIsolation:codexReadIsolation,remoteWorkspace:codexRemoteWorkspace}):name==='claude-agent-sdk'?createClaudeRuntime({configDir:path.join(fs.realpathSync(dataDir),'runtime-sessions','claude'),remoteWorkspace:claudeRemoteWorkspace}):createSdkRuntime({providers,dataDir}));
    instances.set(name,value);return value;
  }
  return {
    startTurn(profile,options) {
      const name=runtimeName(profile);
      if(process.env.MANTA_NATIVE_AGENTS==='disabled'&&name!=='openai-agents-sdk')throw new Error('Native Codex/Claude tools are not enabled in this container deployment. Use an API-mode Agent; broker mode does not yet isolate native Agent processes.');
      if(name==='claude-agent-sdk'&&requireClaudeRemoteWorkspace&&!claudeRemoteWorkspace)throw new Error('Claude 在此隔离项目中需要 Linux guest 传输；尚未配置时不能从宿主机启动。');
      const handle=instance(name).startTurn({...profile,...options,providerId:profile.id});
      if(!handle?.completion||typeof handle.completion.then!=='function')throw new Error('Agent runtime did not return a completion promise');
      return {...handle,runtime:name};
    },
    async close(){await Promise.allSettled([...instances.values()].map(value=>value.close?.()));}
  };
}
