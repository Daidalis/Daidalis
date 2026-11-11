import {mountDocumentViewer} from './document-viewer.mjs';

const sampleInput = document.querySelector('#sample');
const status = document.querySelector('#status');
let viewer, requestVersion = 0;

async function loadModel() {
  const request = ++requestVersion;
  status.textContent = 'Reading model…';
  status.dataset.error = 'false';
  viewer?.destroy();
  viewer = null;
  document.querySelector('#current-viewer').replaceChildren();
  document.querySelector('#model-path').textContent = '';
  document.querySelector('#model-title').textContent = 'model.sysml';
  document.querySelector('#sample-note').textContent = '';
  try {
    const response = await fetch('/api/preview?sample=' + encodeURIComponent(sampleInput.value));
    const result = await response.json();
    if (request !== requestVersion) return;
    if (!response.ok) throw Error(result.error || 'Model loading failed');
    viewer = mountDocumentViewer(document.querySelector('#current-viewer'), {file: result.file, model: result.model});
    document.querySelector('#model-title').textContent = result.file.path.split('/').at(-1);
    document.querySelector('#model-path').textContent = result.file.path;
    document.querySelector('#sample-note').textContent = result.note;
    status.textContent = result.model.valid ? 'Current model loaded; semantic checks passed' : 'Semantic checks failed. The diagram is a partial result; review diagnostics.';
    status.dataset.error = String(!result.model.valid);
    history.replaceState(null, '', '?' + new URLSearchParams({sample: sampleInput.value}));
  } catch (error) {
    if (request !== requestVersion) return;
    viewer?.destroy();
    viewer = null;
    document.querySelector('#current-viewer').replaceChildren();
    status.textContent = 'No new result displayed: ' + error.message;
    status.dataset.error = 'true';
  }
}

const initial = new URLSearchParams(location.search);
if (['original', 'connected'].includes(initial.get('sample'))) sampleInput.value = initial.get('sample');
sampleInput.addEventListener('change', loadModel);
document.querySelector('#reload').addEventListener('click', loadModel);
await loadModel();
