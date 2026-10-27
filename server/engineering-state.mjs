import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { checkGraph, sanitizeGraph } from './model.mjs';

const SCHEMA = 'manta-engineering-state-v1';
const LIMIT = Object.freeze({ historyProjection: 50, objects: 2000, relations: 10000, files: 32, fileBytes: 2 * 1024 * 1024, readBytes: 16 * 1024 * 1024, readPaths: 128, snapshots: 100, evidence: 500, changes: 500 });
const now = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => `${prefix}_${randomUUID()}`;
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail(400, `${label} must be nonempty text (max ${max} characters).`);
  return value.trim();
}
function ids(value = [], label = 'objectIds') {
  if (!Array.isArray(value) || value.length > LIMIT.objects) fail(400, `${label} must be a bounded array.`);
  return [...new Set(value.map(item => text(item, label, 150)))].sort();
}
function actorValue(actor, fallback = 'agent') {
  const result = actor === undefined ? { kind: fallback } : actor;
  if (!result || !['user', 'agent', 'system'].includes(result.kind)) fail(400, 'Invalid engineering actor.');
  return { kind: result.kind, ...(result.id ? { id: text(result.id, 'actor id', 200) } : {}) };
}
function safeJson(value, label, max = 40000) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail(400, `${label} must be JSON.`); }
  if (encoded === undefined || encoded.length > max) fail(400, `${label} is too large or invalid.`);
  return JSON.parse(encoded);
}
function safeRelative(value) {
  const relative = text(value, 'file path', 1024);
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\') || relative.startsWith('~')) fail(400, 'Only project-relative file paths are allowed.');
  const segments = relative.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail(400, 'File path traversal is not allowed.');
  if (segments.some(segment => /^(?:\.git|\.ssh|\.aws|\.codex|\.agents|\.gnupg|\.docker|\.kube|\.azure|node_modules|\.venv|venv|\.DS_Store)$/i.test(segment) || /^\.env(?:\.|$)/i.test(segment) || /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|keychain(?:\..*)?)$/i.test(segment) || /\.(?:pem|key|p12|pfx|keychain-db)$/i.test(segment))) fail(403, 'Secret, system and dependency files cannot be captured.');
  return relative;
}
function selectedPaths(value = []) {
  if (!Array.isArray(value) || value.length > LIMIT.files) fail(413, `Select at most ${LIMIT.files} individual files.`);
  return [...new Set(value.map(safeRelative))].sort();
}
async function fingerprint(root, relative, budget) {
  const target = safeRelative(relative);
  if (budget.paths >= LIMIT.readPaths) fail(413, 'File verification path budget exceeded.');
  budget.paths++;
  let current = root, observedStat;
  for (const segment of target.split('/')) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current); observedStat = stat;
    if (stat.isSymbolicLink()) fail(403, 'Symbolic links cannot be captured.');
  }
  const canonicalTarget = await fs.realpath(current);
  if (!canonicalTarget.startsWith(root + path.sep)) fail(403, 'File must remain inside the project.');
  const handle = await fs.open(current, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (before.dev !== observedStat.dev || before.ino !== observedStat.ino) fail(409, 'File was replaced before capture.');
    if (!before.isFile()) fail(400, 'Select individual regular files, not folders or devices.');
    if (before.size > LIMIT.fileBytes || budget.bytes + before.size > LIMIT.readBytes) fail(413, 'File capture exceeds the small-file verification budget (2 MiB per file, 16 MiB total).');
    budget.bytes += before.size;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) fail(409, 'File changed while being read; retry the capture.');
    // Recheck the pathname after reading to reject replacement during capture.
    const finalStat = await fs.lstat(current);
    if (await fs.realpath(current) !== canonicalTarget || finalStat.isSymbolicLink() || finalStat.dev !== before.dev || finalStat.ino !== before.ino) fail(409, 'File path changed while being read.');
    return { path: target, sha256: createHash('sha256').update(bytes).digest('hex'), size: before.size };
  } finally { await handle.close(); }
}
function objectFact(object) { const { history, ...fact } = object; return clone(fact); }
function replaceObject(ledger, old, fields, actor, at, operation = 'updated') {
  if (old) {
    const history = [...old.history, { ...objectFact(old), operation: 'previous' }];
    Object.assign(old, fields, { revision: old.revision + 1, updatedAt: at, updatedBy: actor, history });
    delete old.deletedAt;
    return old;
  }
  const object = { ...fields, revision: 1, createdAt: at, updatedAt: at, createdBy: actor, updatedBy: actor, history: [] };
  ledger.objects.push(object);
  return object;
}
function normalizeRelations(links) {
  const seen = new Set();
  return links.map(link => {
    const relation = { id: link.id || `relation_${digest([link.source, link.type, link.target]).slice(0, 24)}`, source: text(link.source, 'relation source', 150), target: text(link.target, 'relation target', 150), type: text(link.type, 'relation type', 100) };
    if (seen.has(relation.id)) fail(400, 'Duplicate relation identifier.');
    seen.add(relation.id);
    return relation;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
// A dependency edge points from the consumer to its prerequisite. Generic trace
// links remain ambiguous rather than inventing engineering semantics.
function dependencyPair(relation) {
  if (['depends_on', 'derives_from', 'refines', 'realizes', 'satisfies', 'verifies', 'allocated_to', 'mitigates', 'addresses'].includes(relation.type)) return [relation.source, relation.target];
  if (['derives', 'allocates'].includes(relation.type)) return [relation.target, relation.source];
  return null;
}
function prerequisiteIds(ledger, initial) {
  const found = new Set(initial), queue = [...initial];
  while (queue.length) {
    const current = queue.shift();
    const object = ledger.objects.find(item => item.id === current && !item.deletedAt);
    const prerequisites = [...(object?.dependsOn || [])];
    for (const relation of ledger.relations) { const pair = dependencyPair(relation); if (pair?.[0] === current) prerequisites.push(pair[1]); }
    for (const id of prerequisites) if (!found.has(id)) { found.add(id); queue.push(id); }
  }
  return [...found].sort();
}
function affectedIds(ledger, initial) {
  const found = new Set(initial), queue = [...initial];
  while (queue.length) {
    const current = queue.shift();
    const dependents = ledger.objects.filter(object => !object.deletedAt && object.dependsOn?.includes(current)).map(object => object.id);
    for (const relation of ledger.relations) { const pair = dependencyPair(relation); if (pair?.[1] === current) dependents.push(pair[0]); }
    for (const id of dependents) if (!found.has(id)) { found.add(id); queue.push(id); }
  }
  return [...found].sort();
}
function contextAt(ledger, objectIds) {
  const allIds = prerequisiteIds(ledger, objectIds), ambiguousIds = new Set();
  for (const relation of ledger.relations) if (!dependencyPair(relation)) {
    if (allIds.includes(relation.source) && !allIds.includes(relation.target)) ambiguousIds.add(relation.target);
    if (allIds.includes(relation.target) && !allIds.includes(relation.source)) ambiguousIds.add(relation.source);
  }
  return {
    ambiguousObjectVersions: Object.fromEntries([...ambiguousIds].sort().map(id => [id, ledger.objects.find(object => object.id === id && !object.deletedAt)?.revision ?? null])),
    objectVersions: Object.fromEntries(allIds.map(id => [id, ledger.objects.find(object => object.id === id && !object.deletedAt)?.revision ?? null])),
    relations: ledger.relations.filter(relation => allIds.includes(relation.source) || allIds.includes(relation.target)).map(clone),
    dependencyObjectIds: allIds
  };
}
function getIssues(ledger) {
  const issues = [];
  for (const object of ledger.objects.filter(item => !item.deletedAt)) {
    if (!object.sources?.length) issues.push({ id: `missing-source:${object.id}`, kind: 'missing_source', objectId: object.id, message: '尚未记录权威来源；对象不能据此视为已批准工程事实。' });
    if (/\b(?:TBD|TBC|TBR|TODO)\b|待定|未确定/i.test(`${object.title} ${object.description}`)) issues.push({ id: `unresolved:${object.id}`, kind: 'unresolved_parameter', objectId: object.id, message: '对象中存在待定内容，需要明确依据和责任人。' });
    for (const id of object.dependsOn || []) if (!ledger.objects.some(item => item.id === id && !item.deletedAt)) issues.push({ id: `missing-dependency:${object.id}:${id}`, kind: 'missing_dependency', objectId: object.id, dependencyId: id, message: '显式依赖对象缺失或已删除。' });
  }
  return issues;
}

export function createEngineeringStateService({ store, emit = () => {} }) {
  if (!store?.data || typeof store.save !== 'function' || typeof store.workspace !== 'function') throw new Error('Engineering state requires a persistent project store.');
  if (!Array.isArray(store.data.engineeringStates)) store.data.engineeringStates = [];
  const queues = new Map(), notifications = new WeakMap(), pendingGraphs = new WeakMap();
  function projectLedger(projectId) {
    if (!store.data.projects.some(project => project.id === projectId)) fail(404, 'Project not found.');
    let ledger = store.data.engineeringStates.find(item => item.projectId === projectId);
    if (!ledger) { ledger = { schema: SCHEMA, projectId, revision: 0, objects: [], relations: [], snapshots: [], approvals: [], changes: [], evidence: [], relationHistory: [] }; }
    return ledger;
  }
  function committed(ledger, type, actor) {
    ledger.revision++;
    ledger.updatedAt = now();
    const pending = notifications.get(ledger) || [];
    pending.push({ projectId: ledger.projectId, type: `engineering.${type}`, message: '工程配置记录已更新', data: { revision: ledger.revision, actor } });
    notifications.set(ledger, pending);
  }
  function queued(projectId, operation) {
    const previous = queues.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      // Mutate a private working ledger. A different project's save must never
      // persist this operation's partial state while selected files are hashed.
      const existing = store.data.engineeringStates.find(item => item.projectId === projectId);
      const ledger = clone(projectLedger(projectId));
      const result = await operation(ledger);
      const at = store.data.engineeringStates.findIndex(item => item.projectId === projectId), pendingGraph = pendingGraphs.get(ledger);
      const previousGraphAt = pendingGraph ? store.data.models.findIndex(item => item.projectId === projectId) : -1;
      const previousGraph = previousGraphAt < 0 ? undefined : store.data.models[previousGraphAt];
      if (pendingGraph && ((previousGraph?.version || 0) !== pendingGraph.expectedVersion || stable(previousGraph) !== stable(pendingGraph.previous))) fail(409, 'Model version changed before the engineering configuration could be committed.');
      if (!existing || stable(existing) !== stable(ledger) || pendingGraph) {
        if (at < 0) store.data.engineeringStates.push(ledger); else store.data.engineeringStates[at] = ledger;
        if (pendingGraph) {
          if (previousGraphAt < 0) store.data.models.push(pendingGraph.next); else store.data.models[previousGraphAt] = pendingGraph.next;
        }
        try { store.save(); }
        catch (error) {
          const currentAt = store.data.engineeringStates.findIndex(item => item.projectId === projectId);
          if (existing) store.data.engineeringStates[currentAt] = existing; else store.data.engineeringStates.splice(currentAt, 1);
          if (pendingGraph) {
            const graphAt = store.data.models.findIndex(item => item.projectId === projectId);
            if (previousGraph) store.data.models[graphAt] = previousGraph; else store.data.models.splice(graphAt, 1);
          }
          throw error;
        }
        for (const event of notifications.get(ledger) || []) { try { emit(event); } catch { /* Persistence already succeeded. */ } }
      }
      return result;
    });
    queues.set(projectId, next);
    next.finally(() => { if (queues.get(projectId) === next) queues.delete(projectId); }).catch(() => {});
    return next;
  }
  function sync(ledger, graph, actor) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links) || graph.nodes.length > LIMIT.objects || graph.links.length > LIMIT.relations) fail(400, 'A bounded nodes/links engineering graph is required.');
    const graphFingerprint = digest({ nodes: graph.nodes, links: graph.links });
    if (Number.isFinite(graph.version) && Number.isFinite(ledger.graphVersion) && graph.version < ledger.graphVersion) return;
    if (ledger.graphFingerprint === graphFingerprint) {
      if (Number.isFinite(graph.version) && graph.version > (ledger.graphVersion ?? -1)) { ledger.graphVersion = graph.version; committed(ledger, 'graph_synced', actor); }
      return;
    }
    const at = now(), present = new Set();
    for (const node of graph.nodes) {
      const id = text(node.id, 'graph node id', 150);
      if (present.has(id)) fail(400, 'Duplicate graph node identifier.');
      present.add(id);
      const old = ledger.objects.find(object => object.id === id);
      const fields = { id, kind: text(node.type || node.kind || 'unknown', 'object kind', 100), title: text(node.name || node.title, 'object title', 1000), description: typeof node.description === 'string' ? node.description.slice(0, 20000) : '', sourceStatus: node.status || '', origin: 'graph', authority: old?.authority || 'observed', maturity: old?.maturity || 'candidate', sources: old?.sources || [], dependsOn: old?.dependsOn || [] };
      const comparable = old && Object.fromEntries(Object.keys(fields).map(key => [key, old[key]]));
      if (!old || old.deletedAt || stable(comparable) !== stable(fields)) { fields.maturity = 'candidate'; fields.reviewRecord = null; replaceObject(ledger, old, fields, actor, at); }
    }
    for (const object of ledger.objects) if (object.origin === 'graph' && !object.deletedAt && !present.has(object.id)) {
      object.history.push({ ...objectFact(object), operation: 'previous' });
      object.revision++;
      Object.assign(object, { deletedAt: at, updatedAt: at, updatedBy: actor });
    }
    const relations = normalizeRelations(graph.links);
    for (const relation of relations) if (!present.has(relation.source) || !present.has(relation.target)) fail(400, 'Graph contains a dangling relation.');
    if (stable(relations) !== stable(ledger.relations)) ledger.relationHistory.push({ revision: ledger.revision, relations: clone(ledger.relations), replacedAt: at, actor });
    ledger.relations = relations;
    ledger.graphFingerprint = graphFingerprint;
    ledger.graphVersion = graph.version ?? null;
    committed(ledger, 'graph_synced', actor);
  }
  function lazySync(ledger) {
    const graph = store.data.models?.find(model => model.projectId === ledger.projectId);
    if (graph) sync(ledger, graph, { kind: 'system' });
  }
  async function captureFiles(projectId, paths) {
    const root = await fs.realpath(store.workspace(projectId));
    const budget = { paths: 0, bytes: 0 }, files = [];
    for (const relative of selectedPaths(paths)) {
      try { files.push(await fingerprint(root, relative, budget)); }
      catch (error) { if (error.code === 'ENOENT') fail(400, `Selected file does not exist: ${relative}`); throw error; }
    }
    return files;
  }
  function requireObjects(ledger, selected) {
    for (const id of selected) if (!ledger.objects.some(object => object.id === id && !object.deletedAt)) fail(400, `Object is missing or deleted: ${id}`);
  }
  function ensureSnapshot(ledger, id) { const snapshot = ledger.snapshots.find(item => item.id === id); if (!snapshot) fail(404, 'Snapshot not found in this project.'); return snapshot; }
  async function projection(ledger) {
    const fileCache = new Map(), budget = { paths: 0, bytes: 0 };
    let root;
    try { root = await fs.realpath(store.workspace(ledger.projectId)); } catch { root = null; }
    async function currentFile(file) {
      if (!fileCache.has(file.path)) fileCache.set(file.path, (async () => {
        if (!root) return { state: 'unknown', code: 'workspace_unavailable' };
        try { return { state: 'found', ...(await fingerprint(root, file.path, budget)) }; }
        catch (error) { return { state: error.code === 'ENOENT' ? 'missing' : error.status === 403 || error.status === 400 ? 'invalid' : 'unknown', code: error.code === 'ENOENT' ? 'file_missing' : error.status === 403 ? 'file_path_unsafe' : error.status === 413 ? 'verification_budget' : 'file_unreadable' }; }
      })());
      return fileCache.get(file.path);
    }
    async function applicability(record, evidence = false) {
      const reasons = [], levels = [];
      const reason = (level, code, message, fields = {}) => { levels.push(level); reasons.push({ code, message, ...fields }); };
      const versions = record.objectVersions || {};
      for (const [id, revision] of Object.entries(versions)) {
        const object = ledger.objects.find(item => item.id === id);
        if (!object || object.deletedAt) reason('invalid', 'object_missing', '配置中的对象已删除或缺失；历史结果保留。', { objectId: id });
        else if (revision === null) reason('unknown', 'dependency_unknown', '登记时依赖版本未知。', { objectId: id });
        else if (revision !== object.revision) reason('needs_review', 'object_changed', '对象版本已变化，需要重新判断证据适用性。', { objectId: id, recordedRevision: revision, currentRevision: object.revision });
      }
      for (const [id, revision] of Object.entries(record.ambiguousObjectVersions || {})) {
        const object = ledger.objects.find(item => item.id === id && !item.deletedAt);
        if (!object || revision === null || object.revision !== revision) reason('needs_review', 'uncertain_dependency_changed', '经非定向追溯关系关联的对象已变化，影响需由工程判断。', { objectId: id });
      }
      const relevant = new Set(Object.keys(versions));
      const before = record.relations || [];
      const after = ledger.relations.filter(relation => relevant.has(relation.source) || relevant.has(relation.target));
      if (stable(before) !== stable(after)) {
        const beforeIds = new Map(before.map(relation => [relation.id, relation]));
        const afterIds = new Map(after.map(relation => [relation.id, relation]));
        const delta = [...before.filter(relation => stable(afterIds.get(relation.id)) !== stable(relation)), ...after.filter(relation => stable(beforeIds.get(relation.id)) !== stable(relation))];
        const semantic = delta.some(relation => dependencyPair(relation));
        reason('needs_review', semantic ? 'dependency_relation_changed' : 'ambiguous_relation_changed', semantic ? '相关依赖或验证关系已变化。' : '相关追溯关系变化，其工程影响尚未确定。');
      }
      for (const file of record.files || []) {
        const current = await currentFile(file);
        if (current.state === 'missing') reason('invalid', current.code, '登记文件已缺失；不改变原始结果。', { path: file.path });
        else if (current.state === 'invalid') reason('invalid', current.code, '文件路径已不安全或不再是允许的工程文件。', { path: file.path });
        else if (current.state !== 'found') reason('unknown', current.code, '本次未能核验文件。', { path: file.path });
        else if (current.sha256 !== file.sha256 || current.size !== file.size) reason('needs_review', 'file_changed', '登记文件内容已变化，需要复核或重新执行。', { path: file.path });
      }
      if (evidence) {
        if (!Object.keys(versions).length && !(record.files || []).length) reason('unknown', 'unbound_evidence', '没有绑定对象版本或文件，无法判断对当前工程配置的适用性。');
        if (record.provenance === 'declared') reason('unknown', 'declared_provenance', '这是登记者提供的结果；尚未由受信执行来源核实，不能据此自动判定符合。');
        if (record.result === 'not_executed') reason('unknown', 'not_executed', '记录明确标记尚未执行。');
      }
      const status = levels.includes('invalid') ? 'invalid' : levels.includes('needs_review') ? 'needs_review' : levels.includes('unknown') ? 'unknown' : 'current';
      return { status, reasons, checkedAt: now(), scope: 'Configuration applicability only; historical results and engineering acceptance are separate.' };
    }
    const snapshots = [];
    for (const snapshot of ledger.snapshots) snapshots.push({ ...clone(snapshot), ...(ledger.approvals.find(approval => approval.snapshotId === snapshot.id) ? { approval: clone(ledger.approvals.find(approval => approval.snapshotId === snapshot.id)) } : {}), applicability: await applicability(snapshot) });
    const evidence = [];
    for (const record of ledger.evidence) evidence.push({ ...clone(record), applicability: await applicability(record, true) });
    return { schema: SCHEMA, projectId: ledger.projectId, revision: ledger.revision, objects: ledger.objects.map(object => ({ ...clone(object), history: clone(object.history.slice(-LIMIT.historyProjection)), historyCount: object.history.length, historyTruncated: object.history.length > LIMIT.historyProjection })), relations: clone(ledger.relations), snapshots, changes: clone(ledger.changes), evidence, issues: getIssues(ledger), limits: LIMIT, limitations: ['Observation snapshots are not automatically approved engineering baselines.', 'Evidence registration does not establish execution authenticity or engineering compliance.', 'Whole-configuration restoration, branching and solver checkpoint recovery are not implemented.'] };
  }
  const api = {
    commitGraph(projectId, graph, { actor, expectedVersion } = {}) { return queued(projectId, async ledger => {
      const data = safeJson(graph, 'graph', 2 * 1024 * 1024), validation = checkGraph(data);
      if (!validation.valid) fail(400, validation.errors.join('; '));
      const current = store.data.models.find(model => model.projectId === projectId), version = current?.version || 0;
      const expected = expectedVersion ?? data.version;
      if (!Number.isInteger(expected) || expected < 0) fail(400, 'An expected model version is required.');
      if (expected !== version) fail(409, `Model version conflict: current version ${version}.`);
      const next = sanitizeGraph(data, version + 1), by = actorValue(actor, 'system');
      if (Number.isFinite(ledger.graphVersion) && ledger.graphVersion > version) fail(409, 'Engineering state is ahead of the saved model; reconcile the configuration before writing.');
      sync(ledger, next, by);
      pendingGraphs.set(ledger, { expectedVersion: version, previous: current ? clone(current) : undefined, next: { projectId, ...clone(next) } });
      return clone(next);
    }); },
    get(projectId) { return queued(projectId, async ledger => { lazySync(ledger); return projection(ledger); }); },
    syncGraph(projectId, graph, { actor } = {}) { return queued(projectId, async ledger => { const provided = safeJson(graph, 'graph', 2 * 1024 * 1024);
      const current = store.data.models?.find(model => model.projectId === projectId);
      // Saved traceability state is authoritative over a late notification.
      sync(ledger, current && Number.isFinite(current.version) && current.version >= (provided.version ?? -1) ? current : provided, actorValue(actor, 'system')); return projection(ledger); }); },
    upsertObject(projectId, input, { actor } = {}) { return queued(projectId, async ledger => {
      lazySync(ledger);
      const by = actorValue(actor), data = safeJson(input, 'object'), id = data.id === undefined ? uid('object') : text(data.id, 'object id', 150), old = ledger.objects.find(object => object.id === id);
      if (old && data.expectedRevision !== old.revision) fail(409, `Object revision conflict: expected current revision ${old.revision}.`);
      if (!old && data.expectedRevision !== undefined && data.expectedRevision !== 0) fail(409, 'New objects must have no expectedRevision or expectedRevision 0.');
      const maturity = data.maturity ?? (['reviewed', 'approved'].includes(old?.maturity) ? 'candidate' : old?.maturity) ?? 'candidate', authority = data.authority ?? old?.authority ?? 'observed';
      if (!['candidate', 'observed', 'reviewed', 'approved', 'superseded'].includes(maturity)) fail(400, 'Unsupported engineering maturity.');
      if (['reviewed', 'approved'].includes(maturity) && by.kind !== 'user') fail(403, 'Only a user can record an engineering review or approval.');
      const reviewRecord = ['reviewed', 'approved'].includes(maturity) ? { actor: by, reason: text(data.reviewReason, 'review reason', 4000), reviewedAt: now(), revision: (old?.revision || 0) + 1 } : null;
      if (authority !== 'observed' && authority !== 'declared' && authority !== 'candidate' && by.kind !== 'user' && authority !== old?.authority) fail(403, 'An agent cannot promote engineering authority.');
      const fields = { id, kind: text(data.kind ?? old?.kind ?? 'unknown', 'object kind', 100), title: text(data.title ?? old?.title, 'object title', 1000), description: typeof (data.description ?? old?.description) === 'string' ? (data.description ?? old?.description).slice(0, 20000) : '', authority: safeJson(authority, 'authority', 2000), maturity, reviewRecord, sources: safeJson(data.sources ?? old?.sources ?? [], 'sources', 20000), dependsOn: ids(data.dependsOn ?? old?.dependsOn ?? [], 'dependsOn'), origin: old?.origin || 'engineering', ...(old?.sourceStatus !== undefined ? { sourceStatus: old.sourceStatus } : {}) };
      if (!Array.isArray(fields.sources)) fail(400, 'sources must be an array.');
      if (!old && ledger.objects.length >= LIMIT.objects) fail(413, 'Engineering object limit exceeded.');
      const saved = replaceObject(ledger, old, fields, by, now());
      committed(ledger, 'object_updated', by);
      return clone(saved);
    }); },
    captureSnapshot(projectId, input, { actor } = {}) { return queued(projectId, async ledger => {
      lazySync(ledger);
      if (ledger.snapshots.length >= LIMIT.snapshots) fail(413, 'Observation snapshot limit exceeded.');
      const by = actorValue(actor), name = text(input?.name, 'snapshot name', 500), files = await captureFiles(projectId, input.paths || []);
      const objects = ledger.objects.filter(object => !object.deletedAt);
      const snapshot = { id: uid('snapshot'), name, kind: 'observation', createdAt: now(), actor: by, revision: ledger.revision, files, objectVersions: Object.fromEntries(objects.map(object => [object.id, object.revision])), objects: objects.map(objectFact), relations: clone(ledger.relations), scope: 'Observed selected files and engineering object versions; not a complete project or approved baseline.' };
      ledger.snapshots.push(snapshot); committed(ledger, 'snapshot_captured', by); return clone(snapshot);
    }); },
    approveSnapshot(projectId, snapshotId, input, { actor } = {}) { return queued(projectId, async ledger => {
      const by = actorValue(actor);
      if (by.kind !== 'user') fail(403, 'Only a user can approve an observation snapshot.');
      const reason = text(input?.reason, 'approval reason', 4000), snapshot = ensureSnapshot(ledger, snapshotId);
      if (ledger.approvals.some(approval => approval.snapshotId === snapshot.id)) fail(409, 'This snapshot already has an immutable approval record.');
      const approval = { id: uid('approval'), snapshotId: snapshot.id, actor: by, reason, approvedAt: now(), scope: 'Approval of the recorded observation configuration; not requirement compliance or project acceptance.' };
      ledger.approvals.push(approval); committed(ledger, 'snapshot_approved', by); return { ...clone(snapshot), approval: clone(approval) };
    }); },
    createChange(projectId, input, { actor } = {}) { return queued(projectId, async ledger => {
      lazySync(ledger);
      if (ledger.changes.length >= LIMIT.changes) fail(413, 'Engineering change record limit exceeded.');
      const by = actorValue(actor), title = text(input?.title, 'change title', 1000), reason = text(input?.reason, 'change reason', 4000), objectIds = ids(input.objectIds);
      requireObjects(ledger, objectIds);
      if (input.baseSnapshotId) ensureSnapshot(ledger, input.baseSnapshotId);
      const affectedObjectIds = affectedIds(ledger, objectIds), impact = new Set(affectedObjectIds);
      const affectedEvidenceIds = ledger.evidence.filter(record => [...Object.keys(record.objectVersions || {}), ...Object.keys(record.ambiguousObjectVersions || {})].some(id => impact.has(id))).map(record => record.id);
      const change = { id: uid('change'), title, reason, objectIds, affectedObjectIds, affectedEvidenceIds, ...(input.baseSnapshotId ? { baseSnapshotId: input.baseSnapshotId } : {}), objectVersions: contextAt(ledger, objectIds).objectVersions, createdAt: now(), actor: by, status: 'proposed', impactScope: 'Declared and directional graph dependencies only; ambiguous relations require engineering review.' };
      ledger.changes.push(change); committed(ledger, 'change_recorded', by); return clone(change);
    }); },
    registerEvidence(projectId, input, { actor } = {}) { return queued(projectId, async ledger => {
      lazySync(ledger);
      if (ledger.evidence.length >= LIMIT.evidence) fail(413, 'Evidence record limit exceeded.');
      const by = actorValue(actor), title = text(input?.title, 'evidence title', 1000), scope = text(input.scope, 'evidence scope', 4000), result = input.result;
      if (!['passed', 'failed', 'inconclusive', 'not_executed'].includes(result)) fail(400, 'Evidence result must be passed, failed, inconclusive or not_executed.');
      const objectIds = ids(input.objectIds); requireObjects(ledger, objectIds);
      const snapshot = input.snapshotId ? ensureSnapshot(ledger, input.snapshotId) : null;
      const files = await captureFiles(projectId, input.paths || []), context = contextAt(ledger, objectIds);
      if (snapshot) {
        for (const [id, version] of Object.entries({ ...context.objectVersions, ...context.ambiguousObjectVersions })) if (snapshot.objectVersions[id] !== version) fail(409, 'Evidence objects do not match the selected snapshot; capture a current observation first.');
        for (const file of files) {
          const previous = snapshot.files.find(item => item.path === file.path);
          if (!previous || previous.sha256 !== file.sha256 || previous.size !== file.size) fail(409, 'Evidence files do not match the selected snapshot; capture a current observation first.');
        }
        const relevant = new Set(Object.keys(context.objectVersions));
        const previousRelations = snapshot.relations.filter(relation => relevant.has(relation.source) || relevant.has(relation.target));
        if (stable(previousRelations) !== stable(context.relations)) fail(409, 'Evidence dependency relations do not match the selected snapshot.');
      }
      const evidence = { id: uid('evidence'), title, scope, result, objectIds, ...context, files, provenance: 'declared', createdAt: now(), actor: by, ...(input.runId ? { runId: text(input.runId, 'run id', 200) } : {}), ...(input.artifactId ? { artifactId: text(input.artifactId, 'artifact id', 200) } : {}), ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}), provenanceNote: 'Run and artifact references are declarations; this service has not verified a native execution receipt.' };
      ledger.evidence.push(evidence); committed(ledger, 'evidence_registered', by); return clone(evidence);
    }); }
  };
  return api;
}
