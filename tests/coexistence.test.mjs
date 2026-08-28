import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { apply as localApply, name as localName } from '../lib/index.mjs';
import { apply as upstreamApply, name as upstreamName } from './fixtures/upstream/index.mjs';
import { upstreamEnabled, UPSTREAM_PACKAGE } from '../lib/coexistence.mjs';

const LOCAL_PACKAGE = '@dsh-external/dsh-plugin-local-ai-tts';
const LOCAL_KEY = 'dsh-local-ai-tts-settings';
const OLD_KEY = 'dsh-tts-settings';
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const original = readFileSync(new URL('./fixtures/upstream/client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const messageProps = text => ({ messageId: 'm1', useSession: select => select({ nodes: [
  { kind: 'assistant', messageId: 'm1', blocks: [{ kind: 'text', text }] },
] }) });

function host(inventory) {
  const routes = new Map(), subscriptions = new Set();
  const webServer = { register(route) {
    const key = route.kind + ':' + route.path;
    assert.ok(!routes.has(key), 'duplicate route ' + key);
    routes.set(key, route);
    return () => { assert.equal(routes.get(key), route); routes.delete(key); };
  } };
  function context() {
    const cleanup = [];
    return {
      get: name => name === 'webServer' ? webServer : name === 'loader' && inventory ? { entries: () => inventory } : undefined,
      effect(fn) { const off = fn(); if (typeof off === 'function') cleanup.push(off); },
      on(name, fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); },
      dispose() { for (const off of cleanup.splice(0).reverse()) off(); },
    };
  }
  return { routes, subscriptions, context, paths: () => [...routes.values()].map(r => r.path) };
}

for (const order of ['upstream-first', 'local-first']) {
  test(`Host coexistence: unmodified upstream, ${order}, independent disposal`, t => {
    const h = host([{ options: { name: UPSTREAM_PACKAGE } }]);
    const a = h.context(), b = h.context(); t.after(() => { a.dispose(); b.dispose(); });
    if (order === 'upstream-first') { upstreamApply(a); localApply(b); }
    else { localApply(b); upstreamApply(a); }
    assert.notEqual(localName, upstreamName);
    assert.ok(h.paths().includes('/dsh-tts-api/speak'));
    assert.ok(h.paths().includes('/dsh-local-ai-tts-api/local-runtime'));
    assert.ok(!h.paths().includes('/dsh-local-ai-tts-api/speak'));
    const originals = [...h.routes].filter(([, r]) => r.path.startsWith('/dsh-tts'));
    b.dispose(); assert.deepEqual([...h.routes], originals);
    assert.equal(h.subscriptions.size, 1);
  });

  test(`Host without inventory: isolated routes remain safe, ${order}`, t => {
    const h = host(), a = h.context(), b = h.context(); t.after(() => { a.dispose(); b.dispose(); });
    if (order === 'upstream-first') { upstreamApply(a); localApply(b); }
    else { localApply(b); upstreamApply(a); }
    assert.ok(h.paths().includes('/dsh-tts-api/speak'));
    assert.ok(h.paths().includes('/dsh-local-ai-tts-api/speak'));
    b.dispose(); assert.ok(h.paths().every(p => p.startsWith('/dsh-tts')));
  });
}

test('Host detects enable/disable, restores standalone routes and cleans subscriptions', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const entry = { options: { name: UPSTREAM_PACKAGE, disabled: true } };
  const h = host([entry]), ctx = h.context(); t.after(() => ctx.dispose());
  localApply(ctx); assert.ok(h.paths().includes('/dsh-local-ai-tts-api/speak'));
  assert.equal(h.subscriptions.size, 2);
  entry.options.disabled = false; t.mock.timers.tick(1000);
  assert.deepEqual(h.paths(), ['/dsh-local-ai-tts-api/local-runtime']);
  assert.equal(h.subscriptions.size, 1);
  entry.disabled = true; t.mock.timers.tick(1000);
  assert.ok(h.paths().includes('/dsh-local-ai-tts-api/speak'));
  assert.equal(h.subscriptions.size, 2);
  ctx.dispose(); t.mock.timers.tick(1000); assert.equal(h.routes.size, 0); assert.equal(h.subscriptions.size, 0);
});

test('detection reads only public inventory names/disabled flags, tolerates unavailable service', () => {
  const entry = { options: { name: UPSTREAM_PACKAGE, get config() { throw new Error('must not inspect config'); } } };
  assert.equal(upstreamEnabled({ get: () => ({ entries: () => [entry] }) }), true);
  assert.equal(upstreamEnabled({ get() { throw new Error('not available'); } }), false);
  assert.equal(upstreamEnabled({ get: () => ({ entries: () => [{ options: { name: 'other-plugin' } }] }) }), false);
});

function browser({ boot = [UPSTREAM_PACKAGE, LOCAL_PACKAGE], initial = {}, inventory } = {}) {
  const storage = new Map(Object.entries(initial)), specs = new Map(), modules = new Map(), calls = [], styles = [];
  const intervals = new Map(), timeouts = new Map(); let timerId = 0, owner;
  const effects = new Map(), listeners = new Map();
  const element = tag => ({ tagName: tag, style: {}, dataset: {}, setAttribute() {}, appendChild() {}, removeChild() {}, remove() {},
    pause() {}, load() {}, removeAttribute() {}, play: async () => {}, addEventListener() {}, removeEventListener() {} });
  const document = { createElement: element, body: element('body'), head: { appendChild: x => styles.push(x) },
    addEventListener(name, fn) { const key = owner + ':' + name; const arr = listeners.get(key) || []; arr.push(fn); listeners.set(key, arr); },
    removeEventListener() {} };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect() {}, useMemo: fn => fn(), useRef: init => ({ current: init }) };
  const slots = { inject: (_slot, fn) => fn(), register(spec, component) {
    const key = spec.name + ':' + spec.key; assert.ok(!specs.has(key), 'duplicate UI slot ' + key);
    specs.set(key, { ...spec, component, owner }); return component;
  } };
  const sandbox = { console, navigator: { language: 'en' }, document, Audio: function () { return element('audio'); },
    AbortSignal, atob, btoa,
    setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms, owner }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout(fn) { const id = ++timerId; timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: true, json: async () => ({ ok: true, jobs: [] }) };
    },
  };
  const window = { addEventListener() {}, removeEventListener() {}, confirm: () => true, getSelection: () => null };
  if (boot) window.__DSH_BOOT__ = { entries: boot.map(id => ({ id })) };
  window.__ModuleLoader__ = { load({ id, factory }) {
    assert.ok(!modules.has(id), 'duplicate module ' + id); owner = id;
    const cleanups = []; effects.set(id, cleanups);
    const ctx = { get: name => name === 'slots' ? slots : name === 'loader' && inventory ? { entries: () => inventory } : undefined,
      effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); } };
    const mod = factory(name => { assert.equal(name, 'react'); return react; }); modules.set(id, mod); mod.apply(ctx);
  } };
  sandbox.window = window; vm.createContext(sandbox);
  const render = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(render);
    if (typeof node.type === 'function') return render(node.type(node.props));
    return { ...node, children: node.children.map(render) };
  };
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...node.children.flatMap(all)];
  return { storage, specs, calls, styles, window, listeners,
    load(which) { vm.runInContext(which === 'upstream' ? original : source, sandbox, { filename: which + '-client.js' }); },
    component(key, props = {}) { const spec = [...specs.values()].find(s => s.key === key); assert.ok(spec, 'missing ' + key); return render(react.createElement(spec.component, props)); },
    all, async tick() { for (const { fn } of [...intervals.values()]) await fn(); await flush(); },
    dispose(id) { for (const off of (effects.get(id) || []).splice(0).reverse()) off(); for (const [key, s] of specs) if (s.owner === id) specs.delete(key); modules.delete(id); },
  };
}

for (const order of ['upstream-first', 'local-first']) {
  test(`Browser coexistence: actual original bundle, ${order}, independent UI/storage/globals`, async () => {
    const raw = JSON.stringify({ provider: 'rvc', autoRead: false, voice: 'test-voice', rvc: { baseUrl: 'http://localhost:9998' } });
    const h = browser({ initial: { [OLD_KEY]: raw, 'dsh-tts-lang': 'en' } });
    if (order === 'upstream-first') { h.load('upstream'); h.load('local'); }
    else { h.load('local'); h.load('upstream'); }
    await h.tick();
    const originalSettings = h.window.__dshTtsSettings;
    assert.equal(originalSettings.get().provider, 'rvc');
    assert.equal(h.window.__dshLocalAiTtsSettings.get().provider, 'local-runtime');
    assert.equal(h.storage.get(OLD_KEY), raw);
    assert.ok(h.specs.has('settings.plugins.tab:tts'));
    assert.equal(h.specs.get('settings.plugins.tab:local-ai-tts').label(), 'Local voice');
    const tree = h.component('local-ai-tts');
    const providers = h.all(tree).find(n => n.type === 'select' && n.props.value === 'local-runtime');
    assert.deepEqual(h.all(providers).filter(n => n.type === 'option').map(n => n.props.value), ['local-runtime']);
    const message = h.component('local-ai-tts-read', messageProps('Hello.'));
    assert.ok(h.all(message).some(n => n.props?.['aria-label'] === 'Read this message locally'));
    assert.ok(!h.all(message).some(n => n.props?.['aria-label'] === 'Download audio'));
    h.window.__dshLocalAiTtsSettings.save(); h.window.__dshLocalAiTtsSettings.reset();
    assert.equal(h.window.__dshTtsSettings, originalSettings);
    assert.equal(h.storage.get(OLD_KEY), raw); assert.equal(h.storage.get('dsh-tts-lang'), 'en');
    const localCss = h.styles.find(s => s.textContent?.includes('.dsh-local-ai-tts-settings')).textContent;
    assert.ok(!localCss.includes('[data-tts-tip]')); assert.ok(localCss.includes('[data-local-ai-tts-tip]'));
    h.dispose(LOCAL_PACKAGE); assert.ok(h.specs.has('settings.plugins.tab:tts'));
    assert.equal(h.window.__dshTtsSettings, originalSettings);
    h.dispose(UPSTREAM_PACKAGE);
  });
}

test('standalone UI offers all providers; read-only settings migration persists and does not repeat after reset', () => {
  const raw = JSON.stringify({ autoRead: true, provider: 'rvc', voice: 'test-voice', notify: { enabled: true } });
  const h = browser({ boot: [LOCAL_PACKAGE], initial: { [OLD_KEY]: raw } }); h.load('local');
  const imported = h.window.__dshLocalAiTtsSettings.get();
  assert.equal(imported.autoRead, false); assert.equal(imported.notify.enabled, false); assert.equal(imported.voice, 'test-voice');
  assert.equal(JSON.parse(h.storage.get(LOCAL_KEY)).voice, 'test-voice');
  const panel = h.component('local-ai-tts');
  const select = h.all(panel).find(n => n.type === 'select' && n.props.value === 'rvc');
  assert.deepEqual(h.all(select).filter(n => n.type === 'option').map(n => n.props.value), ['edge-tts', 'rvc', 'indextts-process', 'gpt-sovits-process']);
  h.dispose(LOCAL_PACKAGE); h.load('local'); assert.equal(h.window.__dshLocalAiTtsSettings.get().voice, 'test-voice');
  h.window.__dshLocalAiTtsSettings.reset(); h.dispose(LOCAL_PACKAGE); h.load('local');
  assert.notEqual(h.window.__dshLocalAiTtsSettings.get().voice, 'test-voice'); assert.equal(h.storage.get(OLD_KEY), raw);
  h.dispose(LOCAL_PACKAGE);
});

test('Auto Read guard blocks unknown/enabled upstream; permits disabled upstream; manual remains available', async () => {
  const h = browser({ initial: { [LOCAL_KEY]: JSON.stringify({ provider: 'local-runtime', autoRead: true, localRuntime: { endpoint: 'http://localhost:9999' } }) } });
  h.load('local'); await flush();
  const configCalls = () => h.calls.filter(c => c.body?.action === 'configure');
  assert.equal(configCalls().at(-1).body.autoRead, false);
  assert.equal(h.component('local-ai-tts-autoread').props['aria-pressed'], false);
  let originalAuto = true;
  h.window.__dshTtsSettings = { get: () => ({ autoRead: originalAuto }) };
  await h.tick(); assert.equal(configCalls().at(-1).body.autoRead, false);
  originalAuto = false; await h.tick(); assert.equal(configCalls().at(-1).body.autoRead, true);
  assert.equal(h.component('local-ai-tts-autoread').props['aria-pressed'], true);
  originalAuto = true; await h.tick(); assert.equal(configCalls().at(-1).body.autoRead, false);
  // A suspended local preference can still be switched OFF.
  h.component('local-ai-tts-autoread').props.onClick(); assert.equal(h.window.__dshLocalAiTtsSettings.get().autoRead, false);
  h.component('local-ai-tts-autoread').props.onClick(); assert.equal(h.window.__dshLocalAiTtsSettings.get().autoRead, false);
  const tree = h.component('local-ai-tts-read', messageProps('Manual sentence.'));
  h.all(tree).find(n => n.props?.['aria-label'] === 'Read this message locally').props.onClick({ stopPropagation() {} });
  await flush(); assert.ok(h.calls.some(c => c.body?.action === 'read' && c.body.text === 'Manual sentence.'));
  h.dispose(LOCAL_PACKAGE);
});

test('late detection/disable via inventory, legacy getter fallback and forced companion persistence', async () => {
  const entry = { options: { name: UPSTREAM_PACKAGE, disabled: true } };
  const h = browser({ inventory: [entry] }); h.load('local');
  assert.equal(h.window.__dshLocalAiTtsSettings.get().provider, 'edge-tts');
  entry.options.disabled = false; await h.tick(); assert.equal(h.window.__dshLocalAiTtsSettings.get().provider, 'local-runtime');
  entry.disabled = true; await h.tick();
  assert.match(h.specs.get('settings.plugins.tab:local-ai-tts').label(), /Local AI TTS/);
  const notice = h.all(h.component('local-ai-tts')).find(n => n.type === 'select' && n.props.value === 'auto' && h.all(n).some(c => c.props?.value === 'companion'));
  notice.props.onChange({ target: { value: 'companion' } });
  assert.equal(JSON.parse(h.storage.get(LOCAL_KEY)).coexistenceMode, 'companion');
  h.dispose(LOCAL_PACKAGE); h.load('local'); assert.equal(h.specs.get('settings.plugins.tab:local-ai-tts').label(), 'Local voice'); h.dispose(LOCAL_PACKAGE);
  const old = browser({ boot: null }); old.load('local'); old.load('upstream'); await old.tick();
  assert.equal(old.window.__dshLocalAiTtsSettings.get().provider, 'local-runtime'); old.dispose(LOCAL_PACKAGE); old.dispose(UPSTREAM_PACKAGE);
});
