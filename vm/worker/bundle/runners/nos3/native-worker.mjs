#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createNos3Worker} from './worker.mjs';
import {createNativeNos3Adapter} from './native-adapter.mjs';

// Configuration is provisioned inside the disposable guest, never inherited
// from the user's Codex/Claude/global shell configuration.
const config=JSON.parse(await fs.readFile('/srv/manta/worker/config.json','utf8'));
const adapter=createNativeNos3Adapter({sourceRoot:config.sourceRoot,toolRoot:config.toolRoot,workRoot:config.workRoot,expectedInventoryHash:config.sourceInventorySha256});
const worker=await createNos3Worker({repository:config.sourceRoot+'/nos3',dataDir:'/srv/manta/worker/jobs',token:config.token,executionAdapter:adapter});
worker.server.listen(8093,'127.0.0.1',()=>console.log('Manta native NOS3 worker ready on guest loopback.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>worker.close().then(()=>process.exit(0)));
