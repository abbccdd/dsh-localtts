import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { SentenceBuffer, sentences } from '../lib/local-runtime/sentence-buffer.mjs';
import { DEFAULTS, normalizeConfig, createProvider, IndexTTSAdapter, GPTSoVITSAdapter, pcmToWav } from '../lib/local-runtime/provider.mjs';
import { LocalRuntimeService, registerLocalRuntime } from '../lib/local-runtime/service.mjs';
import { apply } from '../lib/index.mjs';
import { RuntimePool } from '../lib/local-runtime/runtime-pool.mjs';

const wav = pcmToWav(Buffer.alloc(2205 * 2), 22050);
const quiet = { logger() {} };
const config = (endpoint, engine = 'indextts') => ({ endpoint, engine, voice: 'default' });
const eventually = async fn => {
  for (let i = 0; i < 200; i++) { if (fn()) return; await delay(5); }
  assert.ok(fn(), 'condition was not reached');
};
async function mock(t, handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url: req.url, body, headers: req.headers });
    if (handler && await handler(req, res, body)) return;
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ready"}'); }
    else if (['/voices', '/v1/audio/voices'].includes(req.url)) {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ voices: ['default', { id: 'other', name: 'Other voice' }] }));
    } else { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { endpoint: `http://127.0.0.1:${server.address().port}`, calls };
}

test('configuration: no port or personal voice default; validate engine, endpoint, consent', () => {
  assert.equal(DEFAULTS.endpoint, ''); assert.equal(DEFAULTS.voice, 'default');
  assert.equal(normalizeConfig(config('http://localhost:9123/base/')).endpoint, 'http://localhost:9123/base');
  for (const endpoint of ['', 'file:///tmp', 'http://u:p@localhost:80', 'http://localhost/?token=a', 'http://example.com', 'http://169.254.169.254', 'http://192.168.1.2:5000'])
    assert.throws(() => normalizeConfig(config(endpoint)));
  assert.equal(normalizeConfig({ ...config('http://192.168.1.2:5000'), allowLan: true }).allowLan, true);
  assert.throws(() => normalizeConfig({ ...config('http://example.com'), allowLan: true }));
  assert.throws(() => normalizeConfig(config('http://localhost', 'bogus')));
  assert.throws(() => normalizeConfig({ ...config('http://localhost'), timeoutMs: 0 }));
});
test('strict Chinese/English sentence splitting, streamed deltas, soft and hard boundaries', () => {
  assert.deepEqual(sentences('第一句。第二句。第三句。'), ['第一句。', '第二句。', '第三句。']);
  assert.deepEqual(sentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  const b = new SentenceBuffer();
  assert.deepEqual(b.feed('价格3.'), []);
  assert.deepEqual(b.feed('14。好！下一'), ['价格3.14。', '好！']);
  assert.deepEqual(b.flush(), ['下一']);
  const long = '长'.repeat(56) + '，' + '句'.repeat(130) + '。';
  const chunks = sentences(long);
  assert.equal(chunks[0].length, 57); assert.ok(chunks.every(s => Array.from(s).length <= 70));
  assert.equal(chunks.join(''), long);
  assert.deepEqual(sentences('好。是。行。'), ['好。', '是。', '行。']);
  assert.ok(sentences('😀'.repeat(150)).every(s => Array.from(s).length <= 70));
});
test('visual dash separators are never sent to TTS, including streamed pairs', () => {
  assert.deepEqual(sentences('妈妈说：星星——它只是影子。哼两句——'), ['妈妈说：星星 它只是影子。', '哼两句']);
  assert.deepEqual(sentences('第一段。\n---\n第二段。\n━━━\n'), ['第一段。', '第二段。']);
  const streamed = new SentenceBuffer();
  assert.deepEqual(streamed.feed('星星—'), []);
  assert.deepEqual(streamed.feed('—它只是水面的影子。'), ['星星 它只是水面的影子。']);
  assert.deepEqual(streamed.flush(), []);
});
test('IndexTTS adapter health, voices and request contract; no inference options', async t => {
  const m = await mock(t); const p = createProvider(config(m.endpoint), quiet);
  assert.ok(p instanceof IndexTTSAdapter); assert.equal((await p.healthCheck()).ready, true);
  assert.equal((await p.listVoices()).voices[1].id, 'other');
  const audio = await p.synthesize({ text: '第一句。' }); assert.deepEqual(audio.data, wav);
  assert.deepEqual(m.calls.at(-1).body, { text: '第一句。', voice: 'default', engine: 'indextts' });
  assert.equal(m.calls.at(-1).headers.cookie, undefined); assert.equal(m.calls.at(-1).headers.authorization, undefined);
  await assert.rejects(p.synthesize({ text: '一。二。' }), { code: 'SENTENCE' });
  await assert.rejects(p.synthesize({ text: '句。', options: { temperature: 1 } }), { code: 'OPTIONS' });
});
test('GPT-SoVITS adapter uses existing speech bridge without inference parameters', async t => {
  const m = await mock(t); const p = createProvider(config(m.endpoint, 'gpt-sovits'), quiet);
  assert.ok(p instanceof GPTSoVITSAdapter); await p.healthCheck(); await p.listVoices();
  await p.synthesize({ text: 'Hello!', voice: 'other' });
  assert.equal(m.calls[1].url, '/v1/audio/voices'); assert.equal(m.calls[2].url, '/v1/audio/speech');
  assert.deepEqual(m.calls[2].body, { input: 'Hello!', voice: 'other', model: 'gpt-sovits', response_format: 'wav' });
});
test('PCM response is wrapped in WAV without resampling', async t => {
  const m = await mock(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ format: 's16le', sample_rate: 22050, channels: 1, pcm_base64: Buffer.alloc(4410).toString('base64') })); return true; });
  const p = createProvider(config(m.endpoint), quiet);
  assert.deepEqual((await p.synthesize({ text: '句。' })).data, wav);
});
test('voices optional, not-ready health, invalid JSON/audio, HTTP errors redact Runtime text', async t => {
  const m = await mock(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/voices') { res.statusCode = 404; res.end('{}'); }
    else if (req.url === '/health') res.end('{"status":"loading","error":"private text"}');
    else { res.statusCode = 500; res.end('{"error":"private assistant reply"}'); }
    return true;
  });
  const p = createProvider(config(m.endpoint), quiet);
  assert.deepEqual(await p.listVoices(), { supported: false, voices: [] }); assert.equal((await p.healthCheck()).ready, false);
  await assert.rejects(p.synthesize({ text: '句。' }), e => e.code === 'HTTP_500' && !e.message.includes('private'));
  const bad = await mock(t, (_req, res) => { res.end('invalid'); return true; });
  await assert.rejects(createProvider(config(bad.endpoint), quiet).healthCheck(), { code: 'BAD_JSON' });
  await assert.rejects(createProvider(config(bad.endpoint), quiet).synthesize({ text: '句。' }), { code: 'BAD_AUDIO' });
});
test('offline, whole-response timeout, cancellation, redirects blocked', async t => {
  const closed = createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port; await new Promise(r => closed.close(r));
  await assert.rejects(createProvider(config(`http://127.0.0.1:${port}`), quiet).healthCheck(), { code: 'OFFLINE' });
  const slow = await mock(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.write(wav.subarray(0, 10)); return true; });
  const p = createProvider({ ...config(slow.endpoint), timeoutMs: 100 }, quiet);
  await assert.rejects(p.synthesize({ text: '句。' }), e => ['TIMEOUT', 'ECONNRESET'].includes(e.code));
  const q = createProvider(config(slow.endpoint), quiet); const pending = q.synthesize({ text: '句。' });
  await eventually(() => slow.calls.length === 2); q.cancel();
  await assert.rejects(pending, e => ['CANCELLED', 'ECONNRESET'].includes(e.code));
  const redirect = await mock(t, (_req, res) => { res.writeHead(302, { Location: 'http://example.com' }); res.end(); return true; });
  await assert.rejects(createProvider(config(redirect.endpoint), quiet).healthCheck(), { code: 'HTTP_302' });
  assert.equal(redirect.calls.length, 1);
});
test('normal logging has only metadata; debug is explicit', async t => {
  const m = await mock(t), logs = [];
  await createProvider(config(m.endpoint), { logger: l => logs.push(l) }).synthesize({ text: '私密文本。' });
  assert.deepEqual(Object.keys(logs[0]).sort(), ['chars', 'elapsedMs', 'requestId', 'status']);
  await createProvider({ ...config(m.endpoint), debug: true }, { logger: l => logs.push(l) }).synthesize({ text: '调试。' });
  assert.equal(logs[1].text, '调试。');
});

function service(endpoint, opts) {
  const s = new LocalRuntimeService({ providerFactory: c => createProvider(c, quiet), ...opts });
  s.configure({ clientId: 'test_client_123456', config: config(endpoint), sessionId: 's1', autoRead: true });
  return { s, c: s.client('test_client_123456') };
}
function event(s, seq, text, turn = 1, step = 1) { s.ingest({ id: 's1' }, { seq, type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', text } } }); }
function end(s, seq, turn = 1) { s.ingest({ id: 's1' }, { seq, type: 'turn/end', data: { turn } }); }
test('manual three sentences strictly cause three HTTP requests', async t => {
  const m = await mock(t), { s, c } = service(m.endpoint); t.after(() => s.dispose());
  s.read(c, '第一句。第二句。第三句。');
  await eventually(() => c.jobs[0].audio.length === 3);
  assert.deepEqual(m.calls.map(c => c.body.text), ['第一句。', '第二句。', '第三句。']);
});
test('streaming is nonblocking and seq/final-message repeats never reread', async t => {
  const m = await mock(t), { s, c } = service(m.endpoint); t.after(() => s.dispose());
  event(s, 1, '第一句。'); event(s, 1, '第一句。');
  assert.equal(m.calls.length, 0, 'event observer did not synchronously synthesize');
  await eventually(() => c.jobs[0].audio.length === 1);
  event(s, 2, '第二句。'); event(s, 3, '第三句。');
  const finalized = { seq: 4, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一句。第二句。第三句。' }] } } };
  s.ingest({ id: 's1' }, finalized); s.ingest({ id: 's1' }, finalized); end(s, 5);
  await eventually(() => c.jobs[0].audio.length === 3);
  assert.equal(m.calls.length, 3); assert.equal(s.poll(c).jobs[0].done, true);
});
test('unpunctuated tail flushes, non-text blocks ignored, next turn and session isolated', async t => {
  const m = await mock(t), { s, c } = service(m.endpoint); t.after(() => s.dispose());
  s.ingest({ id: 'other' }, { seq: 99, type: 'assistant/chunk', data: { turn: 1, chunk: { type: 'text-delta', text: '别的会话。' } } });
  event(s, 1, '没有标点'); end(s, 2);
  await eventually(() => c.jobs[0].audio.length === 1);
  assert.deepEqual(m.calls.map(x => x.body.text), ['没有标点']);
});
test('stop cancels in-flight, suppresses remaining turn; next manual read works', async t => {
  let release;
  const m = await mock(t, async (_req, res) => {
    if (m.calls.length === 1) { await new Promise(r => release = r); if (!res.destroyed) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); } return true; }
  });
  const { s, c } = service(m.endpoint); t.after(() => s.dispose());
  event(s, 1, '第一句。第二句。'); await eventually(() => !!release);
  s.stop(c); event(s, 2, '第三句。'); release(); await delay(30);
  assert.equal(m.calls.length, 1); assert.equal(s.poll(c).jobs.length, 0);
  s.read(c, '重试。'); await eventually(() => c.jobs[0]?.audio.length === 1);
  assert.equal(m.calls.at(-1).body.text, '重试。');
});
test('synthesis failure is recoverable, engine/voice switching snapshots settings', async t => {
  const m = await mock(t, (req, res, body) => {
    if (body?.text === '失败。') { res.writeHead(500); res.end(); return true; }
  });
  const { s, c } = service(m.endpoint); t.after(() => s.dispose());
  s.read(c, '失败。后续。'); await eventually(() => c.jobs[0]?.error);
  assert.equal(m.calls.length, 1);
  s.configure({ clientId: c.id, config: { ...config(m.endpoint, 'gpt-sovits'), voice: 'other' }, sessionId: 's1' });
  s.read(c, '成功。'); await eventually(() => c.jobs[0]?.audio.length === 1);
  assert.equal(m.calls.at(-1).url, '/v1/audio/speech'); assert.equal(m.calls.at(-1).body.voice, 'other');
});
test('bounded prefetch, pause backpressure, acknowledgement, client lease cleanup', async t => {
  const m = await mock(t); let now = 0;
  const { s, c } = service(m.endpoint, { now: () => now }); t.after(() => s.dispose());
  s.read(c, '一。二。三。四。五。'); await eventually(() => c.jobs[0].audio.length === 3); await delay(25);
  assert.equal(m.calls.length, 3);
  s.poll(c, [{ jobId: c.jobs[0].id, index: 1 }]); await eventually(() => m.calls.length === 4);
  now = 31000; s.sweep(); assert.equal(s.clients.size, 0);
});

test('active browser keeps a loaded WebUI warm between replies', async t => {
  let now = 0, disposed = 0;
  const s = new LocalRuntimeService({ now: () => now, providerFactory: () => ({
    async synthesize() { return { mime: 'audio/wav', data: wav }; }, cancel() {}, dispose() { disposed++; },
  }) });
  t.after(() => s.dispose());
  s.configure({ clientId: 'test_client_123456', config: config('http://127.0.0.1:9876'), sessionId: 's1', autoRead: true });
  const c = s.client('test_client_123456');
  s.read(c, '保持加载。'); await eventually(() => c.jobs[0]?.audio.length === 1);
  s.poll(c, [{ jobId: c.jobs[0].id, index: 1, finished: true }]);
  now = 61000; s.client(c.id); s.sweep();
  assert.equal(s.clients.size, 1); assert.equal(disposed, 0);
  now = 92001; s.sweep();
  assert.equal(s.clients.size, 0); assert.equal(disposed, 1);
});
test('turning Auto Read off and switching session preserve a manual read', async t => {
  const m = await mock(t), { s, c } = service(m.endpoint); t.after(() => s.dispose());
  const result = s.read(c, '手动第一句。手动第二句。');
  s.configure({ clientId: c.id, config: config(m.endpoint), sessionId: 's1', autoRead: false });
  s.configure({ clientId: c.id, config: config(m.endpoint), sessionId: 's2', autoRead: false });
  await eventually(() => c.jobs[0]?.audio.length === 2);
  assert.equal(c.jobs[0].id, result.jobId); assert.equal(m.calls.length, 2);
});
test('Host routes: status/config/read/poll/stop, CSRF/method validation, no cloud fallback', async t => {
  const m = await mock(t), routes = [], cleanup = [];
  const ctx = { get: name => name === 'webServer' ? { register: route => { routes.push(route); return () => {}; } } : undefined,
    effect: fn => { const d = fn(); if (typeof d === 'function') cleanup.push(d); }, on: () => () => {} };
  apply(ctx); t.after(() => cleanup.reverse().forEach(fn => fn()));
  const route = routes.find(r => r.path === '/dsh-local-ai-tts-api/local-runtime');
  async function call(payload, headers = {}, method = 'POST', target = route) {
    let result, code;
    const req = { method, headers: { 'content-type': 'application/json', host: 'localhost:1234', ...headers }, async *[Symbol.asyncIterator]() { yield JSON.stringify(payload); } };
    await target.handler(req, { writeHead: status => code = status, end: body => result = JSON.parse(body) });
    return { result, code };
  }
  assert.equal((await call({ action: 'status', config: config(m.endpoint) })).result.ready, true);
  assert.equal((await call({}, {}, 'GET')).result.code, 'METHOD');
  assert.equal((await call({}, { origin: 'http://evil.test' })).result.code, 'ORIGIN');
  assert.equal((await call({}, { 'content-type': 'text/plain' })).result.code, 'CONTENT_TYPE');
  const base = { clientId: 'route_client_123456' };
  assert.equal((await call({ ...base, action: 'configure', config: config(m.endpoint) })).code, 200);
  const read = await call({ ...base, action: 'read', text: '一。二。三。' }); assert.ok(read.result.jobId);
  assert.equal((await call({ ...base, action: 'poll' })).code, 200);
  assert.equal((await call({ ...base, action: 'stop' })).code, 200);
  const speak = routes.find(r => r.path === '/dsh-local-ai-tts-api/speak');
  assert.equal((await call({ provider: 'local-runtime', text: '句。'.repeat(80) }, {}, 'POST', speak)).code, 400);
});

test('completed turns and active idle time reuse one worker; expiry/config changes release it', async () => {
  let now = 0, created = 0, disposed = 0;
  const s = new LocalRuntimeService({ now: () => now, providerFactory: () => {
    created++;
    return { synthesize: async () => ({ mime: 'audio/wav', data: wav }), cancel() {}, dispose() { disposed++; } };
  } });
  const id = 'reuse_client_123456';
  s.configure({ clientId: id, config: config('http://127.0.0.1:9876') });
  const c = s.client(id);
  for (let i = 0; i < 3; i++) {
    const { jobId } = s.read(c, '一句。');
    await eventually(() => c.jobs[0]?.audio.length === 1 && !c.pumping);
    s.poll(c, [{ jobId, index: 1, finished: true }]);
  }
  assert.equal(created, 1); assert.equal(disposed, 0); assert.equal(c.jobs.length, 0);
  now = 61001; s.client(id); s.sweep(); assert.equal(disposed, 0); assert.equal(s.pool.entries.size, 1);
  s.read(c, '再读。'); await eventually(() => !c.pumping);
  assert.equal(created, 1);
  s.configure({ clientId: id, config: { ...config('http://127.0.0.1:9876'), voice: 'other' } });
  assert.equal(disposed, 1);
  s.read(c, '再读。'); await eventually(() => !c.pumping);
  assert.equal(created, 2);
  now += 31001; s.sweep(); assert.equal(disposed, 2); assert.equal(s.pool.entries.size, 0);
  s.dispose(); assert.equal(disposed, 2);
});

test('shared runtime serializes clients/probes and cancellation stays within its lease', async () => {
  let active = 0, peak = 0, created = 0, disposed = 0;
  const calls = [];
  const pool = new RuntimePool(() => {
    created++;
    return { async synthesize({ text }) { calls.push(text); peak = Math.max(peak, ++active); await delay(20); active--; return text; },
      async healthCheck() { peak = Math.max(peak, ++active); active--; return { ready: true }; }, cancel() { throw new Error('Do not interrupt another client or kill the model on Stop'); }, dispose() { disposed++; } };
  });
  const cfg = { mode: 'process', launchPreset: 'custom', command: 'fixture' };
  const a = pool.acquire(cfg), b = pool.acquire(cfg), probe = pool.acquire(cfg);
  const first = a.synthesize({ text: 'a' });
  await delay(2); a.cancel();
  const second = b.synthesize({ text: 'b' }), check = probe.healthCheck();
  await assert.rejects(first, { code: 'CANCELLED' });
  assert.equal(await second, 'b'); assert.equal((await check).ready, true);
  assert.equal(peak, 1); assert.equal(created, 1); assert.deepEqual(calls, ['a', 'b']);
  // Cancellation after work finishes must not forward to the actual worker.
  a.dispose(); probe.dispose(); assert.equal(disposed, 0);
  // Pool shutdown can cancel the actual transport; this fixture only checks leases.
  pool.entries.values().next().value.provider.cancel = () => {};
  b.dispose(); assert.equal(disposed, 1); assert.equal(pool.entries.size, 0);
});

test('conflicting model settings cannot start another worker for the same project/port', () => {
  const pool = new RuntimePool(() => ({ cancel() {}, dispose() {} }));
  const cfg = { mode: 'process', launchPreset: 'builtin', projectPath: '/fixture/project', engine: 'gpt-sovits', port: 9988 };
  const a = pool.acquire(cfg);
  assert.throws(() => pool.acquire({ ...cfg, voice: 'different' }), { code: 'RUNTIME_IN_USE' });
  assert.throws(() => pool.acquire({ ...cfg, projectPath: '/fixture/other' }), { code: 'RUNTIME_IN_USE' });
  a.dispose(); pool.acquire({ ...cfg, voice: 'different' }).dispose();
});
