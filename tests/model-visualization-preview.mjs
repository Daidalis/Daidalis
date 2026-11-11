import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import init, {PreparedLibrary, Session, version} from '../toolchains/sysml/package/sysmlv2.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = content => crypto.createHash('sha256').update(content).digest('hex');
const samples = {
  original: {
    title: 'Repository model',
    path: 'server/model-backend/nos3-integration.sysml',
    note: 'The original file is unchanged. It declares parts and ports without connections between parts.'
  },
  connected: {
    title: 'Connected example',
    path: 'tests/fixtures/model-visualization/connected-demo.sysml',
    note: 'A visualization test model with three explicit connections, not a NASA model or simulation result.'
  }
};
const files = new Map([
  ['/', ['tests/fixtures/model-visualization/preview.html', 'text/html; charset=utf-8']],
  ['/preview.mjs', ['tests/fixtures/model-visualization/preview.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/workspace-ui.css', ['public/workspace-ui.css', 'text/css; charset=utf-8']],
  ['/document-viewer.mjs', ['public/document-viewer.mjs', 'text/javascript; charset=utf-8']],
  ['/document-viewer.css', ['public/document-viewer.css', 'text/css; charset=utf-8']],
  ['/geojson-viewer.mjs', ['public/geojson-viewer.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/marked/marked.esm.js', ['public/vendor/marked/marked.esm.js', 'text/javascript; charset=utf-8']]
]);
const cache = new Map();

await init({module_or_path: await fs.readFile(path.join(root, 'toolchains/sysml/package/sysmlv2_bg.wasm'))});
if (version() !== '0.10.10') throw Error('Unexpected SysML kernel version');
const standardLibrary = path.join(root, 'toolchains/sysml/package/stdlib');
const library = PreparedLibrary.fromSnapshotStream(
  gunzipSync(await fs.readFile(path.join(standardLibrary, 'sysml-library.prepared.gz'))),
  gunzipSync(await fs.readFile(path.join(standardLibrary, 'sysml-library.json.gz'))).toString('utf8'),
  gunzipSync(await fs.readFile(path.join(standardLibrary, 'sysml-library.libcache.gz')))
);

async function preview(sampleId) {
  const sample = Object.hasOwn(samples, sampleId) ? samples[sampleId] : null;
  if (!sample) throw Object.assign(Error('Unknown sample'), {status: 400});
  const source = await fs.readFile(path.join(root, sample.path), 'utf8');
  const hash = sha(source);
  const cacheKey = sampleId + ':' + hash;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const session = Session.fromSourcesWithPreparedLibrary(JSON.stringify([{name: sample.path, text: source}]), library);
  try {
    const findings = JSON.parse(session.check());
    const valid = !findings.some(finding => finding.severity === 'error' || finding.stage === 'referential');
    const graph = {...JSON.parse(session.toGraph()), interconnection: JSON.parse(session.toGraph('{"view":"interconnection"}'))};
    const value = {
      id: sampleId,
      title: sample.title,
      note: sample.note,
      file: {path: sample.path, content: source, sha256: hash},
      model: {valid, findings, data: graph, backend: {name: 'Open-MBEE SysML v2', version: version()}, model: {sha256: hash}},
      provenance: {
        kernel: version(),
        renderer: 'public/document-viewer.mjs',
        sha256: hash,
        generatedAt: new Date().toISOString()
      }
    };
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, value);
    return value;
  } finally {
    session.free();
  }
}

if (process.argv.includes('--check-only')) {
  try {
    for (const sampleId of Object.keys(samples)) {
      const result = await preview(sampleId);
      console.log(JSON.stringify({sample: sampleId, valid: result.model.valid, sha256: result.file.sha256, nodes: result.model.data.nodes.length, edges: result.model.data.edges.length, interconnectionEdges: result.model.data.interconnection.edges.length, connections: result.model.data.interconnection.edges.filter(edge => edge.kind === 'connect').length}));
    }
  } finally {
    library.free();
  }
} else {
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(Error('Read-only preview'), {status: 405});
      const url = new URL(request.url, 'http://localhost');
      let content, type;
      if (url.pathname === '/api/preview') {
        content = JSON.stringify(await preview(url.searchParams.get('sample') || 'connected'));
        type = 'application/json; charset=utf-8';
      } else if (files.has(url.pathname)) {
        const [relative, mime] = files.get(url.pathname);
        content = await fs.readFile(path.join(root, relative));
        type = mime;
      } else {
        throw Object.assign(Error('Not found'), {status: 404});
      }
      const headers = {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      response.writeHead(error.status || 500, {'Content-Type': 'application/json; charset=utf-8'});
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({error: error.message}));
    }
  });
  const port = Number(process.env.MODEL_PREVIEW_PORT || 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid MODEL_PREVIEW_PORT');
  server.listen(port, '127.0.0.1', () => console.log('Model visualization preview: http://127.0.0.1:' + server.address().port));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => {library.free();process.exit(0);});
  });
}
