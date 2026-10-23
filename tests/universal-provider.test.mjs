import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProvider, normalizeConfig, pcmToWav } from '../lib/local-runtime/provider.mjs';
import { LocalRuntimeService } from '../lib/local-runtime/service.mjs';

const quiet = { logger() {} }, wav = pcmToWav(Buffer.alloc(4000), 24000);
const cfg = endpoint => ({ engine: 'generic', endpoint, protocol: 'openai-speech', model: 'any-local-model', voice: 'speaker-a' });
async function server(t, handler) {
  const calls = [];
  const s = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); calls.push({ url: req.url, body, headers: req.headers });
    if (handler) await handler(req, res, body);
    else { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); }
  });
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return { endpoint: `http://127.0.0.1:${s.address().port}`, calls };
}

test('generic OpenAI accepts model IDs and /v1 bases; protects text/model/voice/stream fields', async t => {
  const s = await server(t), p = createProvider({ ...cfg(s.endpoint + '/v1'), extraBody: JSON.stringify({ speed: 1.2, instructions: 'warm', input: 'stale', model: 'stale', voice: 'stale', stream: true }) }, quiet);
  assert.equal((await p.healthCheck()).status, 'unchecked'); assert.equal(s.calls.length, 0);
  await p.synthesize({ text: 'Hello!' });
  assert.equal(s.calls[0].url, '/v1/audio/speech');
  assert.deepEqual(JSON.parse(s.calls[0].body), { speed: 1.2, instructions: 'warm', input: 'Hello!', model: 'any-local-model', voice: 'speaker-a', stream: false, response_format: 'wav' });
  assert.equal(s.calls[0].headers.authorization, undefined);
  assert.deepEqual(normalizeConfig(p.config), p.config, 'normalization must be idempotent for service/pool reuse');
});

test('JSON templates preserve quotes, newlines, emoji, arrays and typed settings without recursive substitution', async t => {
  const s = await server(t), p = createProvider({ ...cfg(s.endpoint), protocol: 'custom-http', speechPath: '/api/tts?format=wav',
    requestBody: JSON.stringify({ words: '{{text}}', nested: { voice: '{{voice}}', model: '{{model}}' }, settings: [true, 2, null] }) }, quiet);
  const text = 'He said "hi"\n{{voice}}😀';
  await p.synthesize({ text });
  assert.equal(s.calls[0].url, '/api/tts?format=wav');
  assert.deepEqual(JSON.parse(s.calls[0].body), { words: text, nested: { voice: 'speaker-a', model: 'any-local-model' }, settings: [true, 2, null] });
});

test('URL encoded form escapes text and keeps scalar parameters', async t => {
  const s = await server(t), p = createProvider({ ...cfg(s.endpoint), protocol: 'custom-http', requestEncoding: 'form', speechPath: '/inference', requestBody: '{"tts_text":"{{text}}","speaker":"{{voice}}","speed":1.1}' }, quiet);
  await p.synthesize({ text: 'a&b=c+中文' });
  assert.equal(s.calls[0].headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(s.calls[0].body.toString());
  assert.equal(form.get('tts_text'), 'a&b=c+中文'); assert.equal(form.get('speed'), '1.1');
});

test('multipart supports explicit reference audio uploads and raw PCM responses', async t => {
  // Keep generated fixture directories under ignored tmp/ for the user's end-of-task archive.
  const tmp = path.resolve('tmp'); await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(path.join(tmp, 'universal-'));
  const file = path.join(dir, 'reference.wav'); await writeFile(file, wav);
  const pcm = Buffer.alloc(6000);
  const s = await server(t, (_req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.end(pcm); });
  const p = createProvider({ ...cfg(s.endpoint), protocol: 'custom-http', speechPath: '/inference_zero_shot', requestEncoding: 'multipart',
    requestBody: '{"tts_text":"{{text}}","prompt_text":"reference words"}', audioFiles: JSON.stringify({ prompt_wav: file }), responseAudio: 'pcm-s16le', sampleRate: 24000, channels: 1 }, quiet);
  const result = await p.synthesize({ text: '你好。' });
  assert.deepEqual(result.data, pcmToWav(pcm, 24000));
  const call = s.calls[0];
  const fields = await new Response(call.body, { headers: { 'Content-Type': call.headers['content-type'] } }).formData();
  assert.equal(fields.get('tts_text'), '你好。'); assert.equal(fields.get('prompt_text'), 'reference words');
  assert.deepEqual(Buffer.from(await fields.get('prompt_wav').arrayBuffer()), wav);
  assert.ok(!call.body.includes(Buffer.from(file)), 'never send local absolute filenames as multipart metadata');
  const bad = path.join(dir, 'not-audio.wav'); await writeFile(bad, 'private text');
  await assert.rejects(createProvider({ ...p.config, audioFiles: JSON.stringify({ prompt_wav: bad }) }, quiet).synthesize({ text: '你好。' }), { code: 'REFERENCE_AUDIO' });
  assert.equal(s.calls.length, 1, 'bad files fail before sending text/audio to the service');
});

test('auto audio detects WAV despite Piper text/html or binary headers, base64 envelope and legacy PCM JSON', async t => {
  for (const type of ['text/html', 'application/octet-stream', 'audio/x-wav']) {
    const s = await server(t, (_req, res) => { res.setHeader('Content-Type', type); res.end(wav); });
    assert.deepEqual((await createProvider(cfg(s.endpoint), quiet).synthesize({ text: '你好。' })).data, wav);
  }
  const s = await server(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: { audio: wav.toString('base64') } })); });
  assert.deepEqual((await createProvider({ ...cfg(s.endpoint), audioBase64Path: 'result.audio' }, quiet).synthesize({ text: '你好。' })).data, wav);
  await assert.rejects(createProvider({ ...cfg(s.endpoint), audioBase64Path: 'wrong.field' }, quiet).synthesize({ text: '你好。' }), { code: 'BAD_AUDIO' });
  const container = await server(t);
  await assert.rejects(createProvider({ ...cfg(container.endpoint), responseAudio: 'pcm-s16le' }, quiet).synthesize({ text: '你好。' }), { code: 'BAD_AUDIO' });
});

test('health is optional; reachable endpoints do not claim model readiness; voice discovery supports Piper maps', async t => {
  const s = await server(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/info' ? { voice: 'installed', status: 'loading' } : { 'zh_CN-huayan-medium': { num_speakers: 1 } }));
  });
  const p = createProvider({ ...cfg(s.endpoint), healthPath: '/info', healthMode: 'http', voicesPath: '/voices' }, quiet);
  assert.deepEqual(await p.healthCheck(), { ready: false, status: 'reachable', supported: true });
  assert.deepEqual((await p.listVoices()).voices, [{ id: 'zh_CN-huayan-medium', name: 'zh_CN-huayan-medium' }]);
  assert.equal((await createProvider({ ...p.config, healthMode: 'json' }, quiet).healthCheck()).ready, false);
  const optional = createProvider({ ...p.config, healthPath: '', voicesPath: '' }, quiet);
  assert.equal((await optional.listVoices()).supported, false); await optional.healthCheck();
  assert.equal(s.calls.length, 3);
});

test('configuration rejects unknown modes, unsafe routes, malformed templates and ambiguous raw audio metadata', () => {
  const base = cfg('http://127.0.0.1:1234');
  for (const change of [{ model: '' }, { speechPath: 'http://example.com' }, { speechPath: '//example.com' }, { voicesPath: '/x\\y' }, { healthPath: '/x#fragment' },
    { requestBody: '[]' }, { extraBody: '{' }, { responseAudio: 'float32' }, { sampleRate: 0 }, { channels: 3 }, { apiKeyEnv: 'A\r\nX:evil' }])
    assert.throws(() => normalizeConfig({ ...base, ...change }), { code: 'HTTP_CONFIG' });
  for (const requestBody of ['{}', '{"input":"prefix {{text}}"}', '{"input":"{{unknown}}"}'])
    assert.throws(() => normalizeConfig({ ...base, protocol: 'custom-http', requestBody }), { code: 'HTTP_CONFIG' });
  assert.throws(() => normalizeConfig({ ...base, protocol: 'custom-http', requestEncoding: 'form', requestBody: '{"text":"{{text}}","nested":{}}' }), { code: 'HTTP_CONFIG' });
  assert.throws(() => normalizeConfig({ ...base, endpoint: 'https://public.example' }), { code: 'LOCAL_ONLY' });
  assert.throws(() => normalizeConfig({ ...base, endpoint: 'http://192.168.1.2' }), { code: 'LOCAL_ONLY' });
  assert.equal(normalizeConfig({ ...base, endpoint: 'http://192.168.1.2', allowLan: true }).allowLan, true);
  assert.throws(() => normalizeConfig({ mode: 'process', engine: 'generic', launchPreset: 'builtin', command: 'python' }), { code: 'COMMAND' });
});

test('Bearer credentials come only from an explicitly named Host variable and never enter config/logs', async t => {
  const s = await server(t), logs = [];
  const name = 'DSH_TTS_TEST_KEY_' + process.pid;
  process.env[name] = 'private-test-key'; t.after(() => { delete process.env[name]; });
  const p = createProvider({ ...cfg(s.endpoint), apiKeyEnv: name }, { logger: row => logs.push(row) });
  await p.synthesize({ text: '你好。' });
  assert.equal(s.calls[0].headers.authorization, 'Bearer private-test-key');
  assert.ok(!JSON.stringify(p.config).includes('private-test-key')); assert.ok(!JSON.stringify(logs).includes('private-test-key'));
  delete process.env[name];
  await assert.rejects(p.synthesize({ text: '你好。' }), { code: 'AUTH_CONFIG' });
  assert.equal(s.calls.length, 1);
});

test('generic transport rejects redirects, cancels pending bodies, times out and recovers', async t => {
  const redirect = await server(t, (_req, res) => { res.writeHead(302, { Location: 'https://public.example' }); res.end(); });
  await assert.rejects(createProvider(cfg(redirect.endpoint), quiet).synthesize({ text: '你好。' }), { code: 'HTTP_302' });
  const slow = await server(t, async (_req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.write(wav.subarray(0, 12)); await delay(250); res.end(wav.subarray(12)); });
  await assert.rejects(createProvider({ ...cfg(slow.endpoint), timeoutMs: 100 }, quiet).synthesize({ text: '你好。' }), { code: 'TIMEOUT' });
  const p = createProvider(cfg(slow.endpoint), quiet), reading = p.synthesize({ text: '你好。' });
  await delay(10); p.cancel(); await assert.rejects(reading, { code: 'CANCELLED' });
  assert.deepEqual((await p.synthesize({ text: '下一句。' })).data, wav);
});

test('generic JSONL workers reuse the existing sentence/player boundary', async t => {
  const p = createProvider({ mode: 'process', engine: 'generic', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/jsonl-worker.mjs', import.meta.url))], launchPreset: 'custom', voice: 'mock' }, quiet);
  t.after(() => p.dispose());
  assert.equal((await p.healthCheck()).ready, true); assert.equal((await p.synthesize({ text: '你好。' })).mime, 'audio/wav');
});

test('generic service queues one request per sentence and applies the existing playback acknowledgements', async t => {
  const s = await server(t), service = new LocalRuntimeService({ providerFactory: c => createProvider(c, quiet) });
  t.after(() => service.dispose());
  const id = 'generic_test_browser_123'; service.configure({ clientId: id, config: cfg(s.endpoint) });
  const c = service.client(id); service.read(c, '第一句。第二句。第三句。');
  let jobs;
  for (let n = 0; n < 100; n++) { jobs = service.poll(c, []).jobs; if (jobs[0]?.audio.length === 3) break; await delay(5); }
  assert.equal(s.calls.length, 3); assert.equal(jobs[0].audio.length, 3);
  assert.deepEqual(s.calls.map(call => JSON.parse(call.body).input), ['第一句。', '第二句。', '第三句。']);
  service.poll(c, [{ jobId: jobs[0].jobId, index: 3, finished: true }]);
  assert.equal(service.poll(c, []).jobs.length, 0);
});
