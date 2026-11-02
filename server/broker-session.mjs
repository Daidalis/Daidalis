import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const MAX_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const MAX_CALLBACKS = 32;

export function createBrokerSession({runtime,workspace,options,onCall=async()=>{throw Error('Unsupported callback');},onMessage=()=>{},onClose=()=>{},socketPath=process.env.MANTA_BROKER_NATIVE_SOCKET,projectsRoot=process.env.MANTA_PROJECTS_ROOT||'/projects'}) {
  const project = path.relative(fs.realpathSync(projectsRoot), fs.realpathSync(workspace));
  if (!/^project-[A-Za-z0-9_-]{1,100}$/.test(project)) throw Error('Managed project required');
  const socket = net.connect(socketPath);
  socket.setEncoding('utf8');
  let buffer = '', done = false, seq = 0, callbacks = 0;
  const pending = new Map(), control = new AbortController();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});

  function send(message) {
    if (done) throw Error('Isolated session closed');
    const data = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(data) > MAX_FRAME_BYTES) throw Error('Session frame too large');
    if (socket.writableLength + Buffer.byteLength(data) > MAX_QUEUE_BYTES) {
      const error = Error('Session output backpressure limit');
      close(error);
      throw error;
    }
    socket.write(data);
  }

  function close(error = Error('Isolated session closed')) {
    if (done) return;
    done = true;
    clearTimeout(startup);
    control.abort();
    socket.destroy();
    readyReject(error);
    for (const p of pending.values()) { p.cleanup(); p.reject(error); }
    pending.clear();
    onClose(error);
  }

  async function callback(message) {
    try {
      let reply;
      try {
        reply = {result: await onCall(message.method, message.args, control.signal)};
      } catch (error) {
        reply = {error: error?.message || 'Session callback failed'};
      }
      if (!done) send({type: 'reply', id: message.id, ...reply});
    } catch (error) {
      close(error);
    } finally {
      callbacks--;
    }
  }

  function receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
      throw Error('Invalid session response');
    }
    switch (message.type) {
      case 'ready':
        clearTimeout(startup);
        readyResolve();
        break;
      case 'error':
        close(Error(message.message || 'Isolated session failed'));
        break;
      case 'reply': {
        const p = pending.get(message.id);
        if (p) {
          pending.delete(message.id);
          p.cleanup();
          message.error ? p.reject(Error(message.error)) : p.resolve(message.result);
        }
        break;
      }
      case 'call':
        if (callbacks >= MAX_CALLBACKS) throw Error('Session callback limit reached');
        callbacks++;
        void callback(message);
        break;
      default:
        onMessage(message);
    }
  }

  const startup = setTimeout(() => close(Error('Session startup timed out')), 60000);
  startup.unref();
  socket.on('connect', () => {
    try { send({kind: 'service', runtime, project, options}); } catch (error) { close(error); }
  });
  socket.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_QUEUE_BYTES) return close(Error('Session frame too large'));
    let pos;
    while (!done && (pos = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return close(Error('Session frame too large'));
      let message;
      try { message = JSON.parse(line); } catch { return close(Error('Invalid session response')); }
      try { receive(message); } catch (error) { return close(error); }
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) close(Error('Session frame too large'));
  });
  socket.on('error', close);
  socket.on('close', () => close());

  return {
    ready, get closed() { return done; }, send, close,
    async request(method, args, {signal, timeoutMs = 120000, onSent} = {}) {
      if (signal?.aborted) throw Error('Cancelled');
      const abort = () => close(Error('Cancelled'));
      signal?.addEventListener('abort', abort, {once: true});
      try { await ready; } finally { signal?.removeEventListener('abort', abort); }
      if (signal?.aborted) throw Error('Cancelled');
      if (done) throw Error('Isolated session closed');
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => close(Error('Session operation timed out')), timeoutMs);
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        pending.set(id, {resolve, reject, cleanup});
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) return abort();
        try {
          onSent?.(id);
          send({type: 'request', id, method, args});
        } catch (error) {
          pending.delete(id);
          cleanup();
          reject(error);
          close(error);
        }
      });
    },
  };
}
