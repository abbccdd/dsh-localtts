import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalRuntimeService } from '../lib/local-runtime/service.mjs';
import { pcmToWav } from '../lib/local-runtime/provider.mjs';

const source = readFileSync(new URL('../src/local-client.js', import.meta.url), 'utf8');
const coexistenceSource = readFileSync(new URL('../src/coexistence-client.js', import.meta.url), 'utf8');
function harness({ upstream = false } = {}) {
  const requests = [], audioNodes = [], errors = [], effects = [];
  const shared = { provider: 'local-runtime', autoRead: true, speakToken: 0, speaking: false, paused: false };
  const service = new LocalRuntimeService({ providerFactory: c => ({
    async synthesize({ text }) { requests.push({ text, engine: c.engine, voice: c.voice }); await delay(1); return { data: pcmToWav(Buffer.alloc(4410), 22050), mime: 'audio/wav' }; }, cancel() {},
  }) });
  let controller, tick;
  class AudioContext {
    currentTime = 0; destination = {}; state = 'running';
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async decodeAudioData() { return { duration: 0.1 }; }
    createBufferSource() {
      const n = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } };
      audioNodes.push(n); return n;
    }
  }
  const clearSpeaking = () => { shared.speaking = false; shared.paused = false; };
  const stopSpeaking = () => { controller.stop(); shared.speakToken++; clearSpeaking(); };
  let originalAutoRead = false;
  const deps = { shared, window: { AudioContext,
    __DSH_BOOT__: { entries: upstream ? [{ id: '@dsh-external/dsh-plugin-tts' }] : [] },
    __dshTtsSettings: { get: () => ({ autoRead: originalAutoRead }) },
  }, react: {}, slots: { inject() {} }, useSharedForce() {}, t: s => s, togglePause() {},
    ctx: { get() {}, effect: fn => effects.push(fn) }, setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    clearSpeaking, stopSpeaking, showToast: m => errors.push(m), notify() {}, saveSettings() {},
    fetch: async (_url, options) => {
      const p = JSON.parse(options.body); let data;
      if (p.action === 'configure') data = service.configure(p);
      else {
        const c = service.client(p.clientId);
        if (p.action === 'read') data = service.read(c, p.text);
        if (p.action === 'poll') data = service.poll(c, p.acknowledgements);
        if (p.action === 'stop') { service.stop(c); data = { ok: true }; }
      }
      return { ok: true, json: async () => data };
    } };
  const bundle = new Function('deps', `with (deps) { ${coexistenceSource}; ${source}; const localRuntime = createLocalController(); return { controller: localRuntime, refreshCoexistence }; }`)(deps);
  controller = bundle.controller;
  shared.localRuntime.endpoint = 'http://localhost:9999';
  bundle.refreshCoexistence();
  effects.forEach(fn => fn()); controller.session('s1');
  return { shared, service, controller, requests, audioNodes, errors, tick: () => tick(), stopSpeaking,
    upstreamAuto(value) { originalAutoRead = value; bundle.refreshCoexistence(); } };
}
const settle = async (h, predicate) => {
  for (let i = 0; i < 80; i++) { await delay(5); await h.tick(); if (predicate()) return; }
  assert.ok(predicate(), 'client did not settle');
};
test('browser controller pipelines three sentences and schedules consecutive Web Audio buffers', async t => {
  const h = harness(); t.after(() => h.service.dispose());
  h.shared.speaking = true; h.shared.speakSource = 'manual';
  await h.controller.read('第一句。第二句。第三句。');
  await settle(h, () => h.audioNodes.length === 3);
  assert.equal(h.requests.length, 3); assert.equal(h.errors.length, 0);
  for (let i = 1; i < 3; i++) assert.ok(Math.abs(h.audioNodes[i].at - h.audioNodes[i - 1].at - 0.1) < 1e-9);
  for (const n of h.audioNodes) n.onended();
  await h.tick(); await h.tick(); assert.equal(h.shared.speaking, false);
  assert.equal([...h.service.clients.values()][0].jobs.length, 0);
});
test('repeated React session snapshots do not enqueue speech; host events do, only once', async t => {
  const h = harness(); t.after(() => h.service.dispose());
  h.controller.session('s1'); h.controller.session('s1'); await delay(5);
  assert.equal(h.requests.length, 0);
  const event = { seq: 1, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '一。二。三。' } } };
  h.service.ingest({ id: 's1' }, event); h.service.ingest({ id: 's1' }, event);
  h.service.ingest({ id: 's1' }, { seq: 2, type: 'turn/end', data: { turn: 1 } });
  await settle(h, () => h.audioNodes.length === 3);
  assert.equal(h.requests.length, 3); assert.equal(h.shared.speakSource, 'auto');
});
test('stop cancels scheduled audio; settings switch uses a fresh voice/engine; recoverable read', async t => {
  const h = harness(); t.after(() => h.service.dispose());
  h.shared.speaking = true; await h.controller.read('一。二。');
  await settle(h, () => h.audioNodes.length === 2);
  h.stopSpeaking(); assert.ok(h.audioNodes.every(n => n.stopped));
  h.shared.localRuntime.engine = 'gpt-sovits'; h.shared.localRuntime.voice = 'other'; h.controller.sync();
  h.shared.speaking = true; await h.controller.read('再次朗读。');
  await settle(h, () => h.audioNodes.length === 3);
  assert.equal(h.requests.at(-1).engine, 'gpt-sovits'); assert.equal(h.requests.at(-1).voice, 'other');
  assert.equal(h.errors.length, 0);
});
test('paused audio does not acknowledge segments and bounds synthesis prefetch', async t => {
  const h = harness(); t.after(() => h.service.dispose());
  h.shared.speaking = true; await h.controller.read('一。二。三。四。五。');
  await settle(h, () => h.audioNodes.length === 3);
  h.shared.paused = true; await h.shared.audioCtx.suspend();
  await h.tick(); await h.tick(); assert.equal(h.requests.length, 3);
  h.shared.paused = false; await h.shared.audioCtx.resume(); h.audioNodes[0].onended();
  await settle(h, () => h.audioNodes.length === 4); assert.equal(h.requests.length, 4);
});

test('upstream Auto Read activation cancels local automatic audio/queue without breaking manual reads', async t => {
  const h = harness({ upstream: true }); t.after(() => h.service.dispose()); await delay(5);
  const event = (seq, text) => ({ seq, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text } } });
  h.service.ingest({ id: 's1' }, event(1, '一。二。三。四。'));
  await settle(h, () => h.audioNodes.length === 3);
  h.upstreamAuto(true); await h.tick();
  assert.ok(h.audioNodes.every(n => n.stopped));
  assert.equal([...h.service.clients.values()][0].autoRead, false);
  h.service.ingest({ id: 's1' }, event(2, '五。')); await h.tick(); await delay(5);
  assert.equal(h.requests.length, 3);
  h.shared.speaking = true; h.shared.speakSource = 'manual'; await h.controller.read('手动。');
  await settle(h, () => h.audioNodes.length === 4);
  assert.equal(h.requests.at(-1).text, '手动。');
  h.upstreamAuto(false); await h.tick(); h.upstreamAuto(true); await h.tick();
  assert.ok(!h.audioNodes.at(-1).stopped, 'upstream state changes must not stop manual local playback');
});
