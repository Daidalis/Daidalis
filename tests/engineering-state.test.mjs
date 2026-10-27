import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../server/store.mjs';
import { createEngineeringStateService } from '../server/engineering-state.mjs';

const user = { actor: { kind: 'user', id: 'reviewer' } };
const agent = { actor: { kind: 'agent', id: 'worker' } };
const graph = (description = 'Data delivered within TBD contact constraints', links = [{ id: 'satisfies-1', source: 'C-1', target: 'R-1', type: 'satisfies' }, { id: 'verifies-1', source: 'T-1', target: 'R-1', type: 'verifies' }], version = 1) => ({ version, nodes: [{ id: 'R-1', type: 'requirement', name: 'Downlink', description }, { id: 'C-1', type: 'component', name: 'Radio' }, { id: 'T-1', type: 'test', name: 'Contact test' }, { id: 'U-1', type: 'component', name: 'Unrelated structure' }], links });
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
const reason = (record, code) => record.applicability.reasons.some(item => item.code === code);

test('brownfield graph IDs, revisions and history persist across a real store restart', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph(), agent);
  await f.service.syncGraph(f.projectId, graph('Updated requirement', undefined, 2), agent);
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
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); const evidence = await declared(f);
  const row = (await f.service.get(f.projectId)).evidence.find(item => item.id === evidence.id);
  assert.equal(row.provenance, 'declared'); assert.equal(row.result, 'passed'); assert.equal(row.applicability.status, 'unknown'); assert.ok(reason(row, 'declared_provenance'));
  assert.deepEqual(row.objectVersions, { 'C-1': 1, 'R-1': 1 });
});

test('upstream graph change marks dependent evidence for review while unrelated changes leave it unchanged', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); await declared(f);
  const unrelated = graph(); unrelated.nodes.find(item => item.id === 'U-1').description = 'Structure changed'; unrelated.version = 2;
  await f.service.syncGraph(f.projectId, unrelated);
  assert.equal((await f.service.get(f.projectId)).evidence[0].applicability.status, 'unknown');
  assert.ok(!reason((await f.service.get(f.projectId)).evidence[0], 'object_changed'));
  const changed = graph('Requirement changed', undefined, 3); await f.service.syncGraph(f.projectId, changed);
  const row = (await f.service.get(f.projectId)).evidence[0]; assert.equal(row.applicability.status, 'needs_review'); assert.ok(reason(row, 'object_changed')); assert.equal(row.result, 'passed');
});

test('deleted graph objects retain immutable historical versions and invalidate affected applicability', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); await declared(f, { result: 'failed' });
  const next = graph(); next.nodes = next.nodes.filter(item => item.id !== 'C-1'); next.links = next.links.filter(item => item.source !== 'C-1'); next.version = 2;
  await f.service.syncGraph(f.projectId, next);
  const state = await f.service.get(f.projectId), deleted = state.objects.find(item => item.id === 'C-1');
  assert.ok(deleted.deletedAt); assert.equal(deleted.revision, 2); assert.equal(deleted.history[0].title, 'Radio');
  assert.equal(state.evidence[0].applicability.status, 'invalid'); assert.equal(state.evidence[0].result, 'failed');
});

test('changed and unknown relation semantics request local review rather than globally failing evidence', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); await declared(f);
  const next = graph(); next.links = next.links.filter(item => item.source !== 'C-1'); next.version = 2;
  await f.service.syncGraph(f.projectId, next); let row = (await f.service.get(f.projectId)).evidence[0];
  assert.ok(reason(row, 'dependency_relation_changed')); assert.equal(row.applicability.status, 'needs_review');
  const f2 = await fixture(t); await f2.service.syncGraph(f2.projectId, graph()); await declared(f2);
  const ambiguous = graph(); ambiguous.links.push({ id: 'trace', source: 'C-1', target: 'U-1', type: 'traces_to' }); ambiguous.version = 2;
  await f2.service.syncGraph(f2.projectId, ambiguous); row = (await f2.service.get(f2.projectId)).evidence[0]; assert.ok(reason(row, 'ambiguous_relation_changed'));
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
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); await fs.writeFile(path.join(f.folder, 'model.sysml'), 'package M {}');
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

test('graph edits downgrade approval without rewriting the approved historical revision', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph());
  await f.service.upsertObject(f.projectId, { id: 'R-1', expectedRevision: 1, maturity: 'approved', reviewReason: 'Requirement review' }, user);
  await f.service.syncGraph(f.projectId, graph('Changed after review', undefined, 2));
  const object = (await f.service.get(f.projectId)).objects.find(item => item.id === 'R-1');
  assert.equal(object.maturity, 'candidate'); assert.equal(object.revision, 3); assert.equal(object.history[1].maturity, 'approved');
});

test('lazy synchronization reads the authoritative saved graph and ignores late old notifications', async t => {
  const f = await fixture(t); f.store.data.models.push({ projectId: f.projectId, ...graph('Authoritative version two', undefined, 2) }); f.store.save();
  await f.service.syncGraph(f.projectId, graph('Old notification', undefined, 1));
  assert.equal((await f.service.get(f.projectId)).objects.find(item => item.id === 'R-1').description, 'Authoritative version two');
});

test('failed operation after lazy sync cannot leave memory different from persisted state', async t => {
  const f = await fixture(t); f.store.data.models.push({ projectId: f.projectId, ...graph() }); f.store.save();
  await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Invalid', paths: ['missing.txt'] }), error => error.status === 400);
  assert.equal(f.store.data.engineeringStates.length, 0);
  const reopened = createStore(f.options); assert.equal(reopened.data.engineeringStates?.length || 0, 0);
  assert.equal((await f.service.get(f.projectId)).objects.length, 4);
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
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph()); await fs.writeFile(path.join(f.folder, 'a.txt'), 'version one');
  const snapshot = await f.service.captureSnapshot(f.projectId, { name: 'Initial observation', paths: ['a.txt'] });
  const unrelated = graph(); unrelated.nodes.find(item => item.id === 'U-1').description = 'Unrelated revision'; unrelated.version = 2; await f.service.syncGraph(f.projectId, unrelated);
  await declared(f, { snapshotId: snapshot.id, paths: ['a.txt'] });
  await f.service.syncGraph(f.projectId, graph('Changed relevant requirement', undefined, 3));
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

test('older direct graph notifications cannot replace a newer engineering graph', async t => {
  const f = await fixture(t); await f.service.syncGraph(f.projectId, graph('New version', undefined, 3));
  await f.service.syncGraph(f.projectId, graph('Old late version', undefined, 2));
  const state = await f.service.get(f.projectId); assert.equal(state.objects.find(item => item.id === 'R-1').description, 'New version');
});

test('a changed object connected by ambiguous trace requests local review without invalidating unrelated evidence', async t => {
  const f = await fixture(t); const initial = graph(); initial.links.push({ id: 'uncertain', source: 'C-1', target: 'U-1', type: 'traces_to' }); await f.service.syncGraph(f.projectId, initial); await declared(f);
  const next = graph(); next.links = initial.links; next.nodes.find(item => item.id === 'U-1').description = 'Changed uncertain neighbor'; next.version = 2; await f.service.syncGraph(f.projectId, next);
  const row = (await f.service.get(f.projectId)).evidence[0]; assert.equal(row.applicability.status, 'needs_review'); assert.ok(reason(row, 'uncertain_dependency_changed')); assert.equal(row.result, 'passed');
});

test('ordinary project configuration files remain capturable while credential dotfiles are blocked', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.folder, 'config.json'), '{"orbit": "TBD"}');
  const snapshot = await f.service.captureSnapshot(f.projectId, { name: 'Engineering config', paths: ['config.json'] }); assert.equal(snapshot.files[0].path, 'config.json');
  for (const file of ['.npmrc', '.netrc', '.git-credentials']) await assert.rejects(f.service.captureSnapshot(f.projectId, { name: 'Credentials', paths: [file] }), error => error.status === 403);
});

test('commitGraph writes graph and engineering state in exactly one durable save', async t => {
  const f = await fixture(t); let saves = 0; const originalSave = f.store.save; f.store.save = () => { saves++; originalSave(); };
  const saved = await f.service.commitGraph(f.projectId, graph(), { ...user, expectedVersion: 0 });
  assert.equal(saves, 1); assert.equal(saved.version, 1); assert.equal(f.store.data.models[0].version, 1);
  assert.equal(f.store.data.engineeringStates[0].graphVersion, 1); assert.equal(f.store.data.engineeringStates[0].objects.length, 4);
  const reopened = createStore(f.options); assert.equal(reopened.data.models[0].version, 1); assert.equal(reopened.data.engineeringStates[0].graphVersion, 1);
});

test('commitGraph validation and concurrent CAS failures leave both model and ledger unchanged', async t => {
  const f = await fixture(t); await f.service.commitGraph(f.projectId, graph(), { expectedVersion: 0 });
  const before = JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates });
  const bad = graph(); bad.links.push({ source: 'missing', target: 'R-1', type: 'satisfies' });
  await assert.rejects(f.service.commitGraph(f.projectId, bad, { expectedVersion: 1 }), error => error.status === 400);
  assert.equal(JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates }), before);
  const results = await Promise.allSettled(['One', 'Two'].map(description => f.service.commitGraph(f.projectId, graph(description), { expectedVersion: 1 })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  assert.equal(f.store.data.models[0].version, 2); assert.equal(f.store.data.engineeringStates[0].graphVersion, 2);
  assert.equal(f.store.data.models[0].nodes[0].description, f.store.data.engineeringStates[0].objects.find(item => item.id === 'R-1').description);
});

test('commitGraph rolls back graph and ledger together on save failure including first creation', async t => {
  const f = await fixture(t); const originalSave = f.store.save;
  f.store.save = () => { throw new Error('simulated disk failure'); };
  await assert.rejects(f.service.commitGraph(f.projectId, graph(), { expectedVersion: 0 }), /simulated disk failure/);
  assert.equal(f.store.data.models.length, 0); assert.equal(f.store.data.engineeringStates.length, 0);
  f.store.save = originalSave; await f.service.commitGraph(f.projectId, graph(), { expectedVersion: 0 });
  const before = JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates });
  f.store.save = () => { throw new Error('simulated disk failure'); };
  await assert.rejects(f.service.commitGraph(f.projectId, graph('Must not persist'), { expectedVersion: 1 }), /simulated disk failure/);
  assert.equal(JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates }), before);
  f.store.save = originalSave; const reopened = createStore(f.options);
  assert.equal(JSON.stringify({ models: reopened.data.models, engineeringStates: reopened.data.engineeringStates }), before);
});

test('commitGraph synchronization failure cannot persist a partially synchronized graph', async t => {
  const f = await fixture(t); await f.service.commitGraph(f.projectId, graph(), { expectedVersion: 0 });
  // Inject an invalid persisted authority to simulate an incompatible legacy row.
  f.store.data.engineeringStates[0].objects[0].history = null; f.store.save();
  const before = JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates });
  await assert.rejects(f.service.commitGraph(f.projectId, graph('Triggers history update'), { expectedVersion: 1 }));
  assert.equal(JSON.stringify({ models: f.store.data.models, engineeringStates: f.store.data.engineeringStates }), before);
});

test('commitGraph accepts a valid graph above two million ASCII characters within the HTTP 2 MiB limit', async t => {
  const f = await fixture(t), large = { version: 0, nodes: Array.from({ length: 101 }, (_, i) => ({ id: `R-${i}`, type: 'requirement', name: `Requirement ${i}`, description: 'A'.repeat(19950) })), links: [] };
  assert.ok(JSON.stringify(large).length > 2_000_000); assert.ok(JSON.stringify(large).length < 2 * 1024 * 1024);
  const saved = await f.service.commitGraph(f.projectId, large, { expectedVersion: 0 }); assert.equal(saved.version, 1); assert.equal(f.store.data.engineeringStates[0].objects.length, 101);
});
