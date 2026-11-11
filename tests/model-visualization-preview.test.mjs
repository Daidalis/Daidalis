import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {renderDocumentViewer} from '../public/document-viewer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function startPreview(context) {
  const child = spawn(process.execPath, ['tests/model-visualization-preview.mjs'], {
    cwd: root,
    env: {...process.env, MODEL_PREVIEW_PORT: '0'},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Preview did not start: ' + errors)), 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(Error(`Preview exited (${code}): ${errors}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Model visualization preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
}

test('native preview serves real SysML graph data consumable by the existing SVG viewer', {timeout: 30000}, async context => {
  const origin = await startPreview(context);
  for (const sample of ['connected', 'original']) {
    const response = await fetch(`${origin}/api/preview?sample=${sample}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    const source = await fs.readFile(new URL(result.file.path, new URL('../', import.meta.url)), 'utf8');
    assert.equal(result.file.content, source);
    assert.equal(result.file.sha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(result.model.model.sha256, result.file.sha256);
    assert.equal(result.model.valid, true);
    assert.ok(result.model.data.nodes.length > 0);
    assert.ok(result.model.data.edges.length > 0);
    assert.equal(result.model.data.interconnection.view, 'interconnection');
    assert.equal(result.model.data.interconnection.edges.filter(edge => edge.kind === 'connect').length, sample === 'connected' ? 3 : 0);
    const interconnection = renderDocumentViewer({file: result.file, model: result.model});
    assert.match(interconnection,/<option value="structure" selected>结构与互连<\/option>/);
    assert.equal((interconnection.match(/class="semantic-edge semantic-edge-connect"/g) || []).length, sample === 'connected' ? 3 : 0);
    assert.match(renderDocumentViewer({file: result.file, model: result.model}), /class="semantic-svg"/);
    assert.equal(result.diagrams, undefined);
  }
  for (const asset of ['styles.css', 'workspace-ui.css', 'document-viewer.css', 'document-viewer.mjs']) {
    const response = await fetch(`${origin}/${asset}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await fs.readFile(new URL(`../public/${asset}`, import.meta.url), 'utf8'));
  }
});

test('native preview only exposes read-only sample and registered asset routes', {timeout: 30000}, async context => {
  const origin = await startPreview(context);
  for (const sample of ['missing', 'constructor']) assert.equal((await fetch(`${origin}/api/preview?sample=${sample}`)).status, 400);
  assert.equal((await fetch(`${origin}/api/preview`, {method: 'POST'})).status, 405);
  assert.equal((await fetch(`${origin}/package.json`)).status, 404);
  assert.equal((await fetch(`${origin}/artifacts/old.svg`)).status, 404);
  const response = await fetch(`${origin}/`, {method: 'HEAD'});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});
