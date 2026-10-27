import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

// Load only the checkout-local, ignored file; never source shell code or log keys.
const file=fileURLToPath(new URL('../.env',import.meta.url));
try {
  if(fs.statSync(file).isFile())process.loadEnvFile(file);
} catch(error) {
  if(error.code!=='ENOENT')throw new Error('Unable to load the local .env file: '+error.code);
}
