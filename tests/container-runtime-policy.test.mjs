import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeManager} from '../server/runtimes/index.mjs';

test('container policy refuses native coding tools before loading a credential-bearing runtime',()=>{
  const previous=process.env.MANTA_NATIVE_AGENTS;
  process.env.MANTA_NATIVE_AGENTS='disabled';
  try{
    const manager=createRuntimeManager({providers:{},dataDir:'/does-not-exist'});
    for(const type of ['codex-app-server','claude-agent'])assert.throws(()=>manager.startTurn({id:'test',type},{}),/not enabled in this container/);
  }finally{if(previous===undefined)delete process.env.MANTA_NATIVE_AGENTS;else process.env.MANTA_NATIVE_AGENTS=previous;}
});
