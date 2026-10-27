import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const data = JSON.parse(await readFile(new URL('real-issues.v1.json', root), 'utf8'));
const privateData = JSON.parse(await readFile(new URL('evaluator/answers.v1.json', root), 'utf8'));
assert(data.tasks.length >= 12 && data.tasks.length <= 16, 'expected 12–16 tasks');
assert(new Set(data.tasks.map(t => t.project)).size >= 3, 'expected at least 3 projects');
assert(new Set(data.tasks.map(t => t.id)).size === data.tasks.length, 'duplicate id');
assert(privateData.visibility === 'evaluator-only');
for (const t of data.tasks) {
  for (const f of ['id','title','project','repository','issueUrl','category','difficulty','summary','publicPrompt','environment']) assert.equal(typeof t[f], 'string', `${t.id}.${f}`);
  for (const f of ['inputs','deliverables','acceptanceCriteria','tags','sources','limitations','gates','upstreamFacts','curatorAdditions']) assert(Array.isArray(t[f]) && t[f].length, `${t.id}.${f}`);
  assert(['closed','open'].includes(t.status));
  assert.equal(t.evidenceLevel, 'source-verified');
  assert.equal(t.executionStatus, 'not-reproduced');
  assert.equal(t.baselineCommit, null);
  assert.equal(typeof t.hardwareRequired, 'boolean');
  assert(t.gates.every(g => g.status === 'planned-not-executed'));
  assert(!Object.hasOwn(t, 'knownFixReferences') && !Object.hasOwn(t, 'sourceSummary'));
  assert(privateData.answers.some(a => a.taskId === t.id), 'missing evaluator record');
  for (const s of t.sources) assert.equal(new URL(s.url).protocol, 'https:');
}
assert.equal(data.summary.taskCount, data.tasks.length);
assert.equal(data.summary.reproducedCount, 0);
assert.equal(data.summary.runnableFrozenTaskCount, 0);
console.log(JSON.stringify({structure:'pass',tasks:data.tasks.length,projects:new Set(data.tasks.map(t=>t.project)).size,reproduced:0,scope:'dataset structure only'},null,2));
