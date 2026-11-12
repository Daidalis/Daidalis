// Upgrade boundary for names used by earlier releases. New configuration,
// protocols and evidence use the current product name; saved bytes stay intact.
export const legacyInternalDirectory = '.manta';
export const legacyToolNamespace = 'syspilot';
const oldEnvironmentPrefixes = ['MANTA_', 'MBSE_', 'SYSPILOT_'];

export function canonicalEnvironmentName(name) {
  if (typeof name !== 'string') return name;
  const prefix = oldEnvironmentPrefixes.find(prefix => name.startsWith(prefix));
  return prefix ? 'DAIDALIS_' + name.slice(prefix.length) : name;
}

export function normalizeLegacyEnvironment(env) {
  for (const prefix of oldEnvironmentPrefixes) {
    for (const name of Object.keys(env)) {
      if (!name.startsWith(prefix)) continue;
      const current = canonicalEnvironmentName(name);
      if (env[current] === undefined) env[current] = env[name];
    }
  }
  return env;
}

export function environmentValue(env, name) {
  const current = canonicalEnvironmentName(name);
  if (env[current] !== undefined) return env[current];
  if (env[name] !== undefined) return env[name];
  if (typeof current !== 'string' || !current.startsWith('DAIDALIS_')) return undefined;
  for (const prefix of oldEnvironmentPrefixes) {
    const value = env[prefix + current.slice('DAIDALIS_'.length)];
    if (value !== undefined) return value;
  }
}

export function environmentNames(name) {
  const current = canonicalEnvironmentName(name);
  return [...new Set([name, current, ...(typeof current === 'string' && current.startsWith('DAIDALIS_') ? oldEnvironmentPrefixes.map(prefix => prefix + current.slice('DAIDALIS_'.length)) : [])])];
}

export function canonicalProductSchema(value) {
  return typeof value === 'string' ? value.replace(/^(?:manta|syspilot|mbse)-/, 'daidalis-') : value;
}

export const productSchemaMatches = (actual, expected) => canonicalProductSchema(actual) === expected;
export const canonicalToolNamespace = value => value === legacyToolNamespace || value === 'manta' ? 'daidalis' : value;
export const responseItemsFor = data => data?.daidalisResponseItems ?? data?.syspilotResponseItems;
export const legacyNos3JobSchemaFor = workerSchema => workerSchema === 'manta-nos3-worker-v1' ? 'manta-nos3-job-v1' : null;
export function legacyNos3RecipeEnvironment(env) {
  return Object.fromEntries(['JOB_DIR','MODELS_DIR','INPUT'].filter(suffix=>typeof env['DAIDALIS_NOS3_'+suffix]==='string').map(suffix=>['MANTA_NOS3_'+suffix,env['DAIDALIS_NOS3_'+suffix]]));
}

// Used only to recognize unchanged persisted execution contracts after renaming.
// It never transforms user text, evidence, or arbitrary stored configuration.
export function legacyExecutionContract(contract) {
  // Only application-defined tools changed. Workspace and provider values must
  // compare byte-for-byte, including a directory or model named "daidalis".
  return {...contract,tools:JSON.parse(JSON.stringify(contract.tools).replaceAll('Daidalis', 'Manta').replaceAll('DAIDALIS', 'MANTA').replaceAll('daidalis', 'manta'))};
}
