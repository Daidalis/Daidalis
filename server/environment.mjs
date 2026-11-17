import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalizeLegacyEnvironment} from '../shared/legacy-names.mjs';

// Load only the checkout-local, ignored file; never source shell code or log keys.
// A Daidalis checkout nested inside a larger repository reads the parent's .env
// when its own is absent. Existing environment variables always win.
const candidates=[fileURLToPath(new URL('../.env',import.meta.url)),fileURLToPath(new URL('../../.env',import.meta.url))];
const file=candidates.find(location=>{try{return fs.statSync(location).isFile();}catch{return false;}});
try {
  if(file)process.loadEnvFile(file);
} catch(error) {
  if(error.code!=='ENOENT')throw new Error('Unable to load the local .env file: '+error.code);
}
normalizeLegacyEnvironment(process.env);
