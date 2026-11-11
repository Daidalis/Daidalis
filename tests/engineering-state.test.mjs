import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../server/store.mjs';
import { createEngineeringStateService } from '../server/engineering-state.mjs';
import { summarizeEngineeringState, engineeringStatePage, createEngineeringStateRuntime } from '../server/engineering-state-tools.mjs';

const user = { actor: { kind: 'user', id: 'reviewer' } };
const agent = { actor: { kind: 'agent', id: 'worker' } };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manta-engineering-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'project'); await fs.mkdir(folder);
  const options = { dataDir: path.join(root, 'state'), seed: false };
  const store = createStore(options), project = store.createProject({ name: 'STF engineering fixture', folderPath: folder });
  const emitted = [], service = createEngineeringStateService({ store, emit: event => emitted.push(event) });
  return { root, folder, options, store, projectId: project.id, service, emitted };
}
async function declared(f, input = {}) { return f.service.registerEvidence(f.projectId, { title: 'Recorded observation', scope: 'Fixture scope only', result: 'passed', objectIds: ['C-1'], ...input }, agent); }
async function seedObjects(f) {
  for (const object of [
    {id:'R-1',kind:'requirement',title:'Downlink',description:'Data delivered within TBD contact constraints'},
    {id:'C-1',kind:'component',title:'Radio',dependsOn:['R-1']},
    {id:'T-1',kind:'test',title:'Contact test',dependsOn:['R-1']},
    {id:'U-1',kind:'component',title:'Unrelated structure'}
  ]) await f.service.upsertObject(f.projectId, object, agent);
}
const reason = (record, code) => record.applicability.reasons.some(item => item.code === code);

test('explicit engineering IDs, revisions and history persist across a real store restart', async t => {
  const f = await fixture(t); await seedObjects(f);
  await f.service.upsertObject(f.projectId, {id:'R-1',description:'Updated requirement',expectedRevision:1}, agent);
  const reopened = createStore(f.options), service = createEngineeringStateService({ store: reopened });
  const state = await service.get(f.projectId), requirement = state.objects.find(item => item.id === 'R-1');
  assert.equal(state.schema, 'manta-engineering-state-v1'); assert.equal(requirement.revision, 2); assert.equal(requirement.history.length, 1);
  assert.equal(requirement.history[0].description, 'Data delivered within TBD contact constraints');
  assert.equal(requirement.authority, 'observed'); assert.equal(requirement.maturity, 'candidate');
});

test('concurrent CAS accepts exactly one write; missing revision cannot overwrite existing object', async t => {
  const f = await fixture(t); const object = await f.service.upsertObject(f.projectId, { id: 'R', title: 'Initial', kind: 'requirement' }, agent);
  const writes = await Promise.allSettled(['A', 'B'].map(title => f.service.upsertObject(f.projectId, { id: 'R', title, expectedRevision: object.revision }, agent)));
  assert.equal(writes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(writes.find(item => item.status === 'rejected').reason.status, 409);
  await assert.rejects(f.service.upsertObject(f.projectId, { id: 'R', title: 'Unversioned' }, agent), error => error.status === 409);
  assert.equal((await f.service.get(f.projectId)).objects[0].revision, 2);
});

test('declaration provenance remains unknown and does not prove engineering compliance', async t => {
  const f = await fixture(t); await seedObjects(f); const evidence = await declared(f);
  const row = (await f.service.get(f.projectId)).evidence.find(item => item.id === evidence.id);
  assert.equal(row.provenance, 'declared'); assert.equal(row.result, 'passed'); assert.equal(row.applicability.status, 'unknown'); assert.ok(reason(row, 'declared_provenance'));
  assert.deepEqual(row.objectVersions, { 'C-1': 1, 'R-1': 1 });
});

test('upstream object change marks dependent evidence for review while unrelated changes leave it unchanged', async t => {
  const f = await fixture(t); await seedObjects(f); await declared(f);
  await f.service.upsertObject(f.projectId, {id:'U-1',description:'Structure changed',expectedRevision:1});
  assert.equal((await f.service.get(f.projectId)).evidence[0].applicability.status, 'unknown');
  assert.ok(!reason((await f.service.get(f.projectId)).evidence[0], 'object_changed'));
  await f.service.upsertObject(f.projectId, {id:'R-1',description:'Requirement changed',expectedRevision:1});
  const row = (await f.service.get(f.projectId)).evidence[0]; assert.equal(row.applicability.status, 'needs_review'); assert.ok(reason(row, 'object_changed')); assert.equal(row.result, 'passed');
});

test('explicit dependsOn propagates transitive change impact and evidence captures dependencies', async t => {
  const f = await fixture(t);
  await f.service.upsertObject(f.projectId, { id: 'R', title: 'Requirement' });
  await f.service.upsertObject(f.projectId, { id: 'D', title: 'Design', dependsOn: ['R'] });
  await f.service.upsertObject(f.projectId, { id: 'T', title: 'Test', dependsOn: ['D'] });
  const evidence = await f.service.registerEvidence(f.projectId, { title: 'Test receipt', scope: 'A test', result: 'inconclusive', objectIds: ['T'] });
  const change = await f.service.createChange(f.projectId, { title: 'Revise requirement', reason: 'Customer request', objectIds: ['R'] });
  assert.deepEqual(change.affectedObjectIds, ['D', 'R', 'T']); assert.deepEqual(change.affectedEvidenceIds, [evidence.id]);
  await f.service.upsertObject(f.projectId, { id: 'R', title: 'Changed requirement', expectedRevision: 1 });
  const row = (await f.service.get(f.projectId)).evidence[0]; assert.ok(reason(row, 'object_changed')); assert.equal(row.result, 'inconclusive');
});

test('snapshot is an immutable observation with selected file hashes and separate user approval', async t => {
  const f = await fixture(t); await seedObjects(f); await fs.writeFile(path.join(f.folder, 'model.sysml'), 'package M {}');
  const snapshot = await f.service.captureSnapshot(f.projectId, { name: 'Observed config', paths: ['model.sysml'] });
  assert.equal(snapshot.kind, 'observation'); assert.match(snapshot.files[0].sha256, /^[a-f0-9]{64}$/); assert.equal(snapshot.objectVersions['R-1'], 1);
  await assert.rejects(f.service.approveSnapshot(f.projectId, snapshot.id, { reason: 'Agent self approval' }, agent), error => error.status === 403);
  await assert.rejects(f.service.approveSnapshot(f.projectId, snapshot.id, { reason: '' }, user), error => error.status === 400);
  await f.service.approveSnapshot(f.projectId, snapshot.id, { reason: 'Accept observed config for review' }, user);
  const stored = f.store.data.engineeringStates[0]; assert.equal(stored.snapshots[0].approval, undefined); assert.equal(stored.approvals.length, 1);
  await fs.writeFile(path.join(f.folder, 'model.sysml'), 'package Changed {}');
  const projected = (await f.service.get(f.projectId)).snapshots[0]; assert.equal(projected.approval.actor.kind, 'user'); assert.equal(projected.applicability.status, 'needs_review');
  assert.equal(stored.snapshots[0].files[0].sha256, snapshot.files[0].sha256);
});

test('file contents changing or disappearing change applicability but never the recorded result', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'result.csv'), 'x,y\n1,2\n');
  await f.service.registerEvidence(f.projectId, { title: 'Actual file reference', scope: 'Declared CSV', result: 'passed', paths: ['result.csv'] });
  await fs.writeFile(path.join(f.folder, 'result.csv'), 'x,y\n1,3\n'); let row = (await f.service.get(f.projectId)).evidence[0]; assert.ok(reason(row, 'file_changed')); assert.equal(row.applicability.status, 'needs_review');
  await fs.unlink(path.join(f.folder, 'result.csv')); row = (await f.service.get(f.projectId)).evidence[0]; assert.equal(row.applicability.status, 'invalid'); assert.equal(row.result, 'passed');
});

test('project file boundaries reject traversal, symlinks, secrets, folders and oversized files', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'safe.txt'), 'safe'); await fs.mkdir(path.join(f.folder, 'dir'));
  await fs.symlink(path.join(f.folder, 'safe.txt'), path.join(f.folder, 'linked.txt'));
  for (const relative of ['../safe.txt', '/etc/passwd', '.env', '.ssh/id_rsa', 'credentials.json', 'private.key', 'node_modules/library.js', 'linked.txt', 'dir']) await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Unsafe', paths: [relative] }), error => [400, 403].includes(error.status));
  await fs.writeFile(path.join(f.folder, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Large', paths: ['large.bin'] }), error => error.status === 413);
  assert.equal((await f.service.get(f.projectId)).snapshots.length, 0);
});

test('agent cannot self-approve objects; approval requires a human reason and is revision bound', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.upsertObject(f.projectId, { title: 'Fake approval', maturity: 'approved' }, agent), error => error.status === 403);
  await assert.rejects(f.service.upsertObject(f.projectId, { title: 'Approval without reason', maturity: 'approved' }, user), error => error.status === 400);
  const object = await f.service.upsertObject(f.projectId, { id: 'R', title: 'Reviewed', maturity: 'approved', reviewReason: 'Checked requirement sources' }, user);
  assert.equal(object.reviewRecord.revision, 1);
  const changed = await f.service.upsertObject(f.projectId, { id: 'R', title: 'AI changed requirement', expectedRevision: 1 }, agent);
  assert.equal(changed.maturity, 'candidate'); assert.equal(changed.reviewRecord, null); assert.equal(changed.history[0].maturity, 'approved');
});

test('object edits downgrade approval without rewriting the approved historical revision', async t => {
  const f = await fixture(t); await seedObjects(f);
  await f.service.upsertObject(f.projectId, { id: 'R-1', expectedRevision: 1, maturity: 'approved', reviewReason: 'Requirement review' }, user);
  await f.service.upsertObject(f.projectId, {id:'R-1',description:'Changed after review',expectedRevision:2}, agent);
  const object = (await f.service.get(f.projectId)).objects.find(item => item.id === 'R-1');
  assert.equal(object.maturity, 'candidate'); assert.equal(object.revision, 3); assert.equal(object.history[1].maturity, 'approved');
});

test('failed file capture cannot leave memory different from persisted state', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Invalid', paths: ['missing.txt'] }), error => error.status === 400);
  assert.equal(f.store.data.engineeringStates.length, 0);
  const reopened = createStore(f.options); assert.equal(reopened.data.engineeringStates?.length || 0, 0);
  assert.equal((await f.service.get(f.projectId)).objects.length, 0);
});

test('one project failure cannot roll back another project successful commit', async t => {
  const f = await fixture(t); const otherFolder = path.join(f.root, 'other-project'); await fs.mkdir(otherFolder);
  const other = f.store.createProject({ name: 'Other project', folderPath: otherFolder });
  const writes = await Promise.allSettled([f.service.captureSnapshot(f.projectId, { name: 'Will fail', paths: ['missing.txt'] }), f.service.upsertObject(other.id, { id: 'R', title: 'Concurrent success' })]);
  assert.equal(writes[0].status, 'rejected'); assert.equal(writes[1].status, 'fulfilled');
  assert.equal((await f.service.get(other.id)).objects[0].title, 'Concurrent success');
  const reopened = createStore(f.options), recovered = createEngineeringStateService({ store: reopened });
  assert.equal((await recovered.get(other.id)).objects[0].title, 'Concurrent success');
});

test('issues expose unknown sources and unresolved parameters without inventing thresholds', async t => {
  const f = await fixture(t); await f.service.upsertObject(f.projectId, { id: 'R', title: 'Requirement TBR', description: '待定', dependsOn: ['missing'] });
  const state = await f.service.get(f.projectId); assert.ok(state.issues.some(item => item.kind === 'missing_source')); assert.ok(state.issues.some(item => item.kind === 'unresolved_parameter')); assert.ok(state.issues.some(item => item.kind === 'missing_dependency'));
});

test('unbound and unexecuted evidence stays unknown; returned values cannot mutate the ledger', async t => {
  const f = await fixture(t); const created = await f.service.registerEvidence(f.projectId, { title: 'Not run', scope: 'Pending physical test', result: 'not_executed' });
  created.result = 'passed'; const state = await f.service.get(f.projectId); assert.equal(state.evidence[0].result, 'not_executed'); assert.equal(state.evidence[0].applicability.status, 'unknown'); assert.ok(reason(state.evidence[0], 'unbound_evidence')); assert.ok(reason(state.evidence[0], 'not_executed'));
});

test('snapshot-referenced evidence rejects changed, absent and mismatched configuration while permitting an unaffected subset', async t => {
  const f = await fixture(t); await seedObjects(f); await fs.writeFile(path.join(f.folder, 'a.txt'), 'version one');
  const snapshot = await f.service.captureSnapshot(f.projectId, { name: 'Initial observation', paths: ['a.txt'] });
  await f.service.upsertObject(f.projectId, {id:'U-1',description:'Unrelated revision',expectedRevision:1});
  await declared(f, { snapshotId: snapshot.id, paths: ['a.txt'] });
  await f.service.upsertObject(f.projectId, {id:'R-1',description:'Changed relevant requirement',expectedRevision:1});
  await assert.rejects(declared(f, { snapshotId: snapshot.id }), error => error.status === 409);
  await assert.rejects(declared(f, { snapshotId: snapshot.id, objectIds: ['U-1'] }), error => error.status === 409);
  await fs.writeFile(path.join(f.folder, 'a.txt'), 'version two');
  await assert.rejects(declared(f, { snapshotId: snapshot.id, objectIds: [], paths: ['a.txt'] }), error => error.status === 409);
  await fs.writeFile(path.join(f.folder, 'new.txt'), 'not in the observation');
  await assert.rejects(declared(f, { snapshotId: snapshot.id, objectIds: [], paths: ['new.txt'] }), error => error.status === 409);
  await f.service.upsertObject(f.projectId, { id: 'new-object', title: 'Not observed' });
  await assert.rejects(declared(f, { snapshotId: snapshot.id, objectIds: ['new-object'] }), error => error.status === 409);
  assert.equal((await f.service.get(f.projectId)).evidence.length, 1);
});

test('ordinary project configuration files remain capturable while credential dotfiles are blocked', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'config.json'), '{"orbit": "TBD"}');
  const snapshot = await f.service.captureSnapshot(f.projectId, { name: 'Engineering config', paths: ['config.json'] }); assert.equal(snapshot.files[0].path, 'config.json');
  for (const file of ['.npmrc', '.netrc', '.git-credentials']) await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Credentials', paths: [file] }), error => error.status === 403);
});

test('failed engineering saves roll back new and existing ledgers without emitting success', async t => {
  const f = await fixture(t), realSave = f.store.save;
  f.store.save = () => { throw new Error('simulated disk failure'); };
  await assert.rejects(f.service.upsertObject(f.projectId, {id:'R',title:'Initial'}), /simulated disk failure/);
  assert.equal(f.store.data.engineeringStates.length, 0); assert.equal(f.emitted.length, 0);
  f.store.save = realSave; await f.service.upsertObject(f.projectId, {id:'R',title:'Initial'});
  const before = JSON.stringify(f.store.data.engineeringStates), count = f.emitted.length;
  f.store.save = () => { throw new Error('simulated disk failure'); };
  await assert.rejects(f.service.upsertObject(f.projectId, {id:'R',title:'Not persisted',expectedRevision:1}), /simulated disk failure/);
  assert.equal(JSON.stringify(f.store.data.engineeringStates), before); assert.equal(f.emitted.length, count);
  f.store.save = realSave;
  assert.equal(JSON.stringify(createStore(f.options).data.engineeringStates), before);
});

test('legacy project graphs and imported ledger rows are archived once without becoming current records', async t => {
  const f = await fixture(t); await seedObjects(f);
  const imported = f.store.data.engineeringStates[0].objects.find(object => object.id === 'R-1');
  imported.origin = 'graph'; imported.description = 'RETIRED_GRAPH_CONTENT';
  await declared(f);
  const snapshot = await f.service.captureSnapshot(f.projectId, {name:'Old observation'});
  const ledger = f.store.data.engineeringStates[0];
  ledger.relations = [{id:'old-link',source:'C-1',target:'R-1',type:'satisfies'}];
  ledger.graphVersion = 3; ledger.graphFingerprint = 'old-fingerprint';
  ledger.evidence[0].relations = [{id:'RETIRED_GRAPH_EDGE',source:'C-1',target:'R-1',type:'satisfies'}];
  f.store.data.models = [{projectId:f.projectId,version:3,nodes:[{id:'R-1',name:'RETIRED_GRAPH_CONTENT'}],links:ledger.relations}];
  f.store.save();
  const reopened = createStore(f.options), service = createEngineeringStateService({store:reopened});
  const state = await service.get(f.projectId);
  assert.equal(reopened.data.models, undefined); assert.equal(reopened.data.legacyProjectGraphs.length, 1);
  assert.equal(reopened.data.legacyProjectGraphs[0].nodes[0].name, 'RETIRED_GRAPH_CONTENT');
  assert.ok(!state.objects.some(object => object.id === 'R-1')); assert.deepEqual(state.relations, []);
  assert.equal(JSON.stringify(summarizeEngineeringState(state)).includes('RETIRED_GRAPH_CONTENT'), false);
  assert.equal(JSON.stringify(engineeringStatePage(state,{section:'snapshots'})).includes('RETIRED_GRAPH_CONTENT'), false);
  assert.equal(state.snapshots[0].objects.find(object => object.id === 'R-1').description, 'RETIRED_GRAPH_CONTENT');
  assert.equal(state.evidence[0].relations[0].id, 'RETIRED_GRAPH_EDGE');
  assert.equal(JSON.stringify(summarizeEngineeringState(state)).includes('RETIRED_GRAPH_EDGE'), false);
  assert.equal(JSON.stringify(engineeringStatePage(state,{section:'evidence'})).includes('RETIRED_GRAPH_EDGE'), false);
  assert.equal(state.snapshots[0].id, snapshot.id); assert.equal(state.snapshots[0].applicability.status, 'invalid');
  assert.equal(state.evidence[0].result, 'passed'); assert.equal(state.evidence[0].applicability.status, 'invalid');
  assert.ok(state.issues.some(issue => issue.kind === 'missing_dependency'));
  assert.equal(reopened.data.engineeringStates[0].legacyProjectGraph.objects.length, 1);
  assert.equal(service.commitGraph, undefined); assert.equal(service.syncGraph, undefined);
  const revision = state.revision, archive = JSON.stringify(reopened.data.engineeringStates[0].legacyProjectGraph);
  const again = createStore(f.options);
  assert.equal(again.data.legacyProjectGraphs.length, 1); assert.equal(again.data.engineeringStates[0].revision, revision);
  assert.equal(JSON.stringify(again.data.engineeringStates[0].legacyProjectGraph), archive);
  // An explicit new observation with the same ID must not resurrect old evidence.
  const restored = await service.upsertObject(f.projectId, {id:'R-1',title:'New sourced requirement',sources:['models/current.sysml']});
  assert.equal(restored.origin, 'engineering'); assert.equal(restored.revision, 2);
  assert.equal((await service.get(f.projectId)).evidence[0].applicability.status, 'needs_review');
});

test('agent object writes preserve archived revisions without replaying graph history in tool results', async t => {
  const f = await fixture(t);
  await f.service.upsertObject(f.projectId, {id:'R-1',title:'RETIRED_GRAPH_CONTENT'});
  await f.service.upsertObject(f.projectId, {id:'R-1',title:'RETIRED_GRAPH_REVISION',expectedRevision:1});
  await f.service.upsertObject(f.projectId, {id:'R-approved',title:'Old approved candidate'});
  for (const object of f.store.data.engineeringStates[0].objects) object.origin = 'graph';
  await declared(f, {objectIds:['R-1']});
  f.store.save();
  const reopened = createStore(f.options), service = createEngineeringStateService({store:reopened});
  const runtime = createEngineeringStateRuntime({service,authorizeMutation:async()=>{}});
  const ctx = {projectId:f.projectId,isCoordinator:true,agentId:'coordinator'};
  const created = await runtime.execute('record_engineering_object', {id:'R-1',title:'Current sourced requirement'}, ctx);
  assert.equal(created.revision, 3); assert.equal(created.title, 'Current sourced requirement');
  assert.equal(created.history, undefined); assert.equal(created.historyCount, 2);
  assert.equal(JSON.stringify(created).includes('RETIRED_GRAPH'), false);
  const updated = await runtime.execute('record_engineering_object', {id:'R-1',title:'Reviewed current requirement',expectedRevision:3}, ctx);
  assert.equal(updated.revision, 4); assert.equal(updated.history, undefined); assert.equal(updated.historyCount, 3);
  assert.equal(JSON.stringify(updated).includes('RETIRED_GRAPH'), false);
  const state = await service.get(f.projectId);
  assert.equal(state.objects[0].history[0].title, 'RETIRED_GRAPH_CONTENT');
  assert.equal(state.objects[0].history[1].title, 'RETIRED_GRAPH_REVISION');
  assert.equal(state.evidence[0].result, 'passed'); assert.equal(state.evidence[0].applicability.status, 'needs_review');
  const approved = await service.upsertObject(f.projectId, {id:'R-approved',title:'Current reviewed requirement',maturity:'approved',reviewReason:'Current requirement checked'}, user);
  assert.equal(approved.revision, 2);
  assert.equal(approved.reviewRecord.revision, approved.revision);
});
