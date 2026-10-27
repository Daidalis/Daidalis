// Model choice belongs to a thread, independently of its Agent connection.
export const isCodexProvider = provider => ['codex-app-server','codex-cli'].includes(provider?.type);
export function modelCatalogKey(provider, projectId) {
  return JSON.stringify([provider?.id, provider?.type, provider?.baseUrl || '', provider?.model || '', projectId]);
}
export function resolveCodexModel({provider, thread, runs = [], catalog, choice}) {
  if (!isCodexProvider(provider)) return undefined;
  if (choice !== undefined && choice !== '') return choice;
  const preferences = thread?.modelPreferences || {};
  const hasPreference = Object.hasOwn(preferences, provider.id);
  if (choice === undefined && hasPreference && preferences[provider.id]) return preferences[provider.id];
  // Existing worker threads may predate persisted model preferences.
  if (choice === undefined && !hasPreference) {
    const previous = runs.filter(run => run.providerId === provider.id).at(-1);
    if (previous?.model) return previous.model;
  }
  return provider.model || catalog?.defaultModel || '';
}
export function codexModelOptions(catalog, selected) {
  const options = (catalog?.models || []).map(item => ({value:item.model, label:item.displayName || item.model}));
  if (selected && !options.some(item => item.value === selected)) options.unshift({value:selected,label:selected});
  return options;
}
