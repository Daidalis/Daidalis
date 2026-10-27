import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../server/index.mjs';
import { createEvaluator } from '../server/evaluator.mjs';
import { safePath } from '../server/sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(await fs.readFile(path.join(root, 'datasets/real-issues.v1.json'), 'utf8'));
const privateAnswers = JSON.parse(await fs.readFile(path.join(root, 'datasets/evaluator/answers.v1.json'), 'utf8'));
async function appFixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbse-review-'));
  const app = await createStudioServer({ root, dataDir, seed: false, computer: false });
  const address = await app.listen({ port: 0 });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url, body) => fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { app, base, request };
}

test('review: official-source dataset preserves unexecuted and unfrozen status', () => {
  assert.equal(dataset.tasks.length, 13);
  assert.equal(new Set(dataset.tasks.map(t => t.project)).size, 4);
  for (const task of dataset.tasks) {
    assert.equal(task.executionStatus, 'not-reproduced');
    assert.equal(task.baselineCommit, null);
    assert(task.gates.every(g => g.status === 'planned-not-executed'));
    assert(!Object.hasOwn(task, 'knownFixReferences'));
    assert(!Object.hasOwn(task, 'sourceSummary'));
  }
  assert.equal(privateAnswers.visibility, 'evaluator-only');
  assert(privateAnswers.answers.every(a => a.goldenPatchAvailable === false));
});

test('review: public HTTP includes actual task prompt and engineering evidence boundaries', async t => {
  const { request } = await appFixture(t);
  const response = await request('/api/benchmarks/nos3-351');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.publicPrompt, dataset.tasks.find(t => t.id === 'nos3-351').publicPrompt);
  assert.equal(body.executionStatus, 'not-reproduced');
  assert.equal(body.evidenceLevel, 'source-verified');
  assert.equal(body.baselineCommit, null);
  assert(body.inputs?.length > 0);
  assert(body.limitations?.length > 0);
  assert.equal(body.contractChallenge.upstreamReproduction, false);
});

test('review: task import does not copy evaluator answers and preserves the public assignment', async t => {
  const { app, request } = await appFixture(t);
  const missingFolder = await request('/api/benchmarks/nos3-351/start', {});
  assert.equal(missingFolder.status, 400);
  const existing = app.store.createProject({ name: 'Imported task review' });
  const response = await request('/api/benchmarks/nos3-351/start', { projectId: existing.id });
  assert.equal(response.status, 201);
  const { project } = await response.json();
  const imported = JSON.parse(await fs.readFile(path.join(app.store.workspace(project.id), 'task.json'), 'utf8'));
  assert.equal(imported.publicPrompt, dataset.tasks.find(t => t.id === 'nos3-351').publicPrompt);
  assert.equal(imported.executionStatus, 'not-reproduced');
  const text = JSON.stringify(imported);
  for (const key of ['knownFixReferences', 'goldenPatchAvailable', 'evaluatorGuidance', 'sourceSummary']) assert(!text.includes('"' + key + '"'));
  const blocked = await request('/datasets/evaluator/answers.v1.json');
  assert.notEqual(blocked.status, 200);
  const traversal = await request('/%2e%2e%2fdatasets/evaluator/answers.v1.json');
  assert.notEqual(traversal.status, 200);
});

test('review: hostile cross-origin API requests fail before project creation', async t => {
  const { app, base } = await appFixture(t);
  const response = await fetch(base + '/api/projects', { method: 'POST', headers: { origin: 'https://hostile.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'should not exist' }) });
  assert.equal(response.status, 403);
  assert.equal(app.store.data.projects.length, 0);
});

test('review: self-reported passed tests cannot upgrade deliverables to engineering passed', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mbse-grade-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspaces', 'p');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'requirements.md'), 'Requirement R1: this is a candidate-written claim.');
  await fs.writeFile(path.join(workspace, 'change.md'), 'Candidate says everything works. This is not independent evidence.');
  await fs.writeFile(path.join(workspace, 'model.json'), JSON.stringify({ nodes: [{ id: 'r', type: 'requirement' }, { id: 't', type: 'verification' }], links: [{ source: 'r', target: 't' }] }));
  await fs.writeFile(path.join(workspace, 'verification.json'), JSON.stringify({ tests: [{ id: 'fake', status: 'passed', evidence: 'candidate assertion' }] }));
  const evaluator = await createEvaluator({ root: directory, dataDir: directory, workspacesDir: path.join(directory, 'workspaces') });
  const report = await evaluator.evaluate({ taskId: 'nos3-800', projectId: 'p' });
  assert.notEqual(report.status, 'passed');
  assert.equal(report.engineeringStatus, 'not-evaluated');
  assert.equal(report.upstreamReproduction, false);
  assert.equal(report.scope, 'deliverable-completeness');
});

test('review: evaluator refuses submission symlinks and project id traversal', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mbse-path-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspaces', 'p');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(directory, 'outside.txt'), 'private evaluator fixture');
  await fs.symlink(path.join(directory, 'outside.txt'), path.join(workspace, 'requirements.md'));
  assert.throws(() => safePath(workspace, '../outside.txt'), /escapes/);
  assert.throws(() => safePath(workspace, 'requirements.md'), /Symbolic/);
  const evaluator = await createEvaluator({ root: directory, dataDir: directory, workspacesDir: path.join(directory, 'workspaces') });
  await assert.rejects(evaluator.evaluate({ taskId: 'nos3-351', projectId: 'p' }), /symlink escapes/);
  await assert.rejects(evaluator.evaluate({ taskId: 'nos3-351', projectId: '../p' }), /projectId/);
});
