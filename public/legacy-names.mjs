// Read compatibility for persisted links, recorded results and native shells.
// New links and messages are always emitted under the Daidalis name.
const threadPrefixes = ['#daidalis-thread:', '#manta-thread:', '#syspilot-thread:'];
export const THREAD_MENTION_PREFIX = threadPrefixes[0];
export function threadMentionReference(value) {
  if(typeof value!=='string')return null;
  const prefix=threadPrefixes.find(prefix=>value.startsWith(prefix));
  return prefix?{prefix,id:value.slice(prefix.length)}:null;
}
export function containsThreadMention(text,threadId) {
  return typeof text==='string'&&threadPrefixes.some(prefix=>text.includes(prefix+threadId));
}
export function isRecordedTrajectorySchema(schema) {
  return schema==='daidalis-recorded-trajectory-v1'||schema==='manta-recorded-trajectory-v1';
}
export function isThermalModelSchema(schema) {
  return schema==='daidalis-thermal-model-v1'||schema==='mbse-thermal-model-v1';
}
export function nativeProjectBridge(global) {
  return global?.webkit?.messageHandlers?.daidalis||global?.webkit?.messageHandlers?.syspilot;
}
export function installLegacyFolderReply(global,reply) {
  global.syspilotFolderSelected=reply;
}
export function listenForSettings(global,listener) {
  for(const type of ['daidalis:open-settings','syspilot:open-settings'])global.addEventListener(type,listener);
}
export function isOpenFileMessage(type) {
  return type==='daidalis:open-file'||type==='manta:open-file';
}
