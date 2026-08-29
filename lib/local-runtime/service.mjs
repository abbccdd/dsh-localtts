import { randomUUID } from 'node:crypto';
import { SentenceBuffer, sentences } from './sentence-buffer.mjs';
import { createProvider, normalizeConfig, RuntimeError } from './provider.mjs';
import { discoverEngine } from './discovery.mjs';
import { RuntimePool } from './runtime-pool.mjs';

const error = (code, message) => new RuntimeError(code, message);
export class LocalRuntimeService {
  constructor({ providerFactory = createProvider, now = Date.now } = {}) {
    this.clients = new Map(); this.providerFactory = providerFactory; this.now = now;
    this.pool = new RuntimePool(providerFactory);
  }
  configure({ clientId, config, sessionId = '', autoRead = false }) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId || '')) throw error('CLIENT', 'Invalid client ID.');
    const normalized = normalizeConfig(config);
    let c = this.clients.get(clientId);
    if (!c) {
      if (this.clients.size >= 32) throw error('LIMIT', 'Too many active TTS clients.');
      c = { id: clientId, jobs: [], maxSeq: -1, seenSteps: new Set(), suppressedTurn: null };
      this.clients.set(clientId, c);
    }
    if (JSON.stringify(c.config) !== JSON.stringify(normalized)) { this.stop(c); this.release(c); }
    else if (c.sessionId !== sessionId || (c.autoRead && !autoRead)) this.stop(c, 'auto');
    if (c.sessionId !== sessionId) { c.maxSeq = -1; c.suppressedTurn = null; c.seenSteps.clear(); }
    Object.assign(c, { config: normalized, sessionId: String(sessionId).slice(0, 256), autoRead: !!autoRead, touched: this.now() });
    return { ok: true };
  }
  client(id) {
    const c = this.clients.get(id);
    if (!c) throw error('CLIENT_EXPIRED', 'TTS session expired. Reconnect and try again.');
    c.touched = this.now(); return c;
  }
  newJob(c, source, turn = null) {
    c.provider ||= this.pool.acquire(c.config);
    c.lastWork = this.now();
    const j = { id: randomUUID(), source, turn, provider: c.provider, buffer: new SentenceBuffer(),
      queue: [], audio: [], index: 0, done: false, running: false, cancelled: false, error: null, created: this.now(), chars: 0 };
    c.jobs.push(j); return j;
  }
  release(c) { c.provider?.dispose(); c.provider = null; }
  add(c, j, parts) {
    for (const text of parts) {
      j.chars += text.length;
      if (j.chars > 100000 || j.queue.length >= 2048) {
        j.error = { code: 'LIMIT', message: 'Reply exceeds the Local Runtime queue limit.' };
        j.queue = []; j.done = true; j.provider.cancel(); return;
      }
      j.queue.push(text);
    }
    this.pump(c);
  }
  pump(c) {
    if (c.pumping || c.jobs.reduce((n, j) => n + j.audio.length, 0) >= 3) return;
    const j = c.jobs.find(j => !j.cancelled && !j.error && j.queue.length);
    if (!j) return;
    c.pumping = true; j.running = true;
    const text = j.queue.shift();
    Promise.resolve().then(() => j.cancelled ? null : j.provider.synthesize({ text })).then(a => {
      if (a && !j.cancelled) j.audio.push({ index: ++j.index, mime: a.mime, data: a.data.toString('base64') });
    }).catch(e => {
      if (!j.cancelled) { j.error = { code: e.code || 'SYNTHESIS', message: e instanceof RuntimeError ? e.message : 'Runtime synthesis failed.' }; j.queue = []; j.done = true; }
    }).finally(() => { j.running = false; c.pumping = false; c.lastWork = this.now(); this.pump(c); });
  }
  read(c, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw error('TEXT', 'Text must contain 1–100000 characters.');
    this.stop(c);
    const j = this.newJob(c, 'manual'); j.done = true; this.add(c, j, sentences(text));
    return { jobId: j.id };
  }
  stop(c, source) {
    for (const j of c.jobs) {
      if (source && j.source !== source) continue;
      if (j.source === 'auto') c.suppressedTurn = j.turn;
      j.cancelled = true; j.queue = []; j.audio = []; j.buffer.buffer = ''; if (j.running) j.provider.cancel();
    }
    c.jobs = source ? c.jobs.filter(j => j.source !== source) : []; c.lastWork = this.now();
  }
  poll(c, acknowledgements = []) {
    for (const ack of acknowledgements.slice(0, 16)) {
      const j = c.jobs.find(j => j.id === ack.jobId);
      if (!j || !Number.isInteger(ack.index)) continue;
      j.audio = j.audio.filter(a => a.index > ack.index);
      if (ack.finished && j.done && !j.running && !j.queue.length && !j.audio.length) c.jobs = c.jobs.filter(x => x !== j);
    }
    this.pump(c);
    return { jobs: c.jobs.map(j => ({ jobId: j.id, source: j.source, done: j.done && !j.running && !j.queue.length,
      error: j.error, audio: j.audio })) };
  }
  ingest(session, event) {
    const sid = session?.id || session?.sessionId;
    if (!sid || !event || !Number.isInteger(event.seq)) return;
    for (const c of this.clients.values()) {
      if (c.sessionId !== sid || event.seq <= c.maxSeq) continue;
      c.maxSeq = event.seq;
      if (!c.autoRead || this.now() - c.touched > 30000) continue;
      const d = event.data || {}, turn = d.turn;
      if (turn == null || turn === c.suppressedTurn) continue;
      let j = c.jobs.find(j => j.source === 'auto' && j.turn === turn);
      if (j?.error || j?.cancelled) continue;
      const delta = event.type === 'assistant/chunk' && d.chunk?.type === 'text-delta' ? d.chunk.text : '';
      const step = `${turn}:${d.step}`;
      if (delta || event.type === 'assistant/message') {
        // Manual reads take precedence until the next turn.
        if (c.jobs.some(x => x.source === 'manual')) { c.suppressedTurn = turn; continue; }
        if (!j) {
          if (c.jobs.length >= 8) continue;
          j = this.newJob(c, 'auto', turn);
        }
        if (delta) {
          c.seenSteps.add(step);
          while (c.seenSteps.size > 256) c.seenSteps.delete(c.seenSteps.values().next().value);
          this.add(c, j, j.buffer.feed(delta));
        } else {
          if (!c.seenSteps.has(step)) {
            const text = (d.message?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
            this.add(c, j, j.buffer.feed(text)); c.seenSteps.add(step);
          }
          this.add(c, j, j.buffer.flush());
        }
      }
      if (event.type === 'turn/end' && j) { this.add(c, j, j.buffer.flush()); j.done = true; }
    }
  }
  sweep() {
    for (const [id, c] of this.clients) {
      if (this.now() - c.touched > 30000 || c.jobs.some(j => this.now() - j.created > 1800000)) { this.stop(c); this.release(c); this.clients.delete(id); }
      // An active browser polls often enough to keep `touched` fresh. Keep its
      // model lease warm between replies: unloading a multi-GB WebUI after one
      // quiet minute turns every normal pause into another cold start. Stale
      // tabs are still reclaimed by the branch above, and Host disposal closes
      // every owned worker when DSH exits.
    }
  }
  dispose() { for (const c of this.clients.values()) { this.stop(c); this.release(c); } this.clients.clear(); this.pool.dispose(); }
}

async function readBody(req) {
  if (req.method !== 'POST') throw error('METHOD', 'Use POST.');
  if (!String(req.headers?.['content-type'] || '').startsWith('application/json')) throw error('CONTENT_TYPE', 'Use application/json.');
  const origin = req.headers?.origin;
  if (origin) {
    let host; try { host = new URL(origin).host; } catch { throw error('ORIGIN', 'Invalid Origin.'); }
    if (host !== req.headers.host) throw error('ORIGIN', 'Cross-origin TTS requests are blocked.');
  }
  if (req.headers?.['sec-fetch-site'] === 'cross-site') throw error('ORIGIN', 'Cross-site TTS requests are blocked.');
  let size = 0; const parts = [];
  for await (const p of req) {
    const b = Buffer.from(p); size += b.length;
    if (size > 512000) throw error('LIMIT', 'Request too large.');
    parts.push(b);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw error('JSON', 'Invalid JSON request.'); }
}
export function registerLocalRuntime(ctx, webServer) {
  const service = new LocalRuntimeService();
  const handler = async (req, res) => {
    try {
      const p = await readBody(req); let data;
      if (p.action === 'discover') data = await discoverEngine(p);
      else if (p.action === 'configure') data = service.configure(p);
      else if (p.action === 'status') {
        const provider = service.pool.acquire(normalizeConfig(p.config));
        try {
          const health = await provider.healthCheck();
          let voices = { supported: false, voices: [] }, warning;
          try { voices = await provider.listVoices(); } catch (e) { warning = e instanceof RuntimeError ? e.message : 'Voice query failed.'; }
          data = { ...health, ...voices, ...(warning ? { warning } : {}) };
        } finally { provider.dispose?.(); provider.cancel?.(); }
      } else {
        const c = service.client(p.clientId);
        if (p.action === 'read') data = service.read(c, p.text);
        else if (p.action === 'poll') data = service.poll(c, p.acknowledgements || []);
        else if (p.action === 'stop') { service.stop(c); data = { ok: true }; }
        else throw error('ACTION', 'Unknown Local Runtime action.');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: e instanceof RuntimeError ? e.message : 'Local Runtime request failed.', code: e.code || 'INTERNAL' }));
    }
  };
  const disposers = [webServer.register({ kind: 'exact', path: '/dsh-local-ai-tts-api/local-runtime', handler })];
  ctx.effect(() => () => disposers.forEach(dispose => dispose?.()), 'local-runtime: routes');
  if (typeof ctx.on === 'function') ctx.effect(() => ctx.on('session/event', (session, event) => {
    try { service.ingest(session, event); } catch { /* never interrupt Harness message handling */ }
  }), 'local-runtime: assistant events');
  ctx.effect(() => { const timer = setInterval(() => service.sweep(), 10000); timer.unref?.(); return () => { clearInterval(timer); service.dispose(); }; }, 'local-runtime: cleanup');
  return service;
}
