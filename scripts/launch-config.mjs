import '../server/environment.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Emit one validated, non-secret value. Shell launchers never source or eval .env.
const root=fileURLToPath(new URL('../',import.meta.url));
const port=process.env.PORT||'4317';
if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('PORT must be an integer from 1 to 65535');
const data=path.resolve(root,process.env.MBSE_DATA_DIR||'data');
if(/[\0\r\n]/.test(data))throw new Error('MBSE_DATA_DIR must not contain control characters');
const key=process.argv[2];
if(key!=='port'&&key!=='data')throw new Error('Use launch-config.mjs port|data');
process.stdout.write(key==='port'?port:data);
