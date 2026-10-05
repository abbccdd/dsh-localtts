import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/update-client.js', import.meta.url), 'utf8').replace('__LOCAL_PLUGIN_VERSION__', '0.1.10');
const release = (version, extras = {}) => ({ tag_name: `v${version}`, prerelease: true, assets: [{
  name: `dsh-external-dsh-plugin-local-ai-tts-${version}.tgz`,
  browser_download_url: `https://github.com/abbccdd/dsh-localtts/releases/download/v${version}/dsh-external-dsh-plugin-local-ai-tts-${version}.tgz`,
}], ...extras });
function fixture({ kind = 'github', current = '0.1.10', diskVersion = current, updateAvailable = true, failure, result = { ok: true } } = {}) {
  const calls = [], values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const request = async (url, options) => {
    calls.push({ url, options });
    if (failure === 'network' && url.startsWith('https:')) throw new Error('Offline');
    const data = url.startsWith('https:') ? [release('0.1.11')] : url.includes('/updates') ?
      { updates: { '@dsh-external/dsh-plugin-local-ai-tts': { kind, version: diskVersion, updateAvailable } } } : result;
    return { status: failure === 'missing-market' && url.startsWith('/') ? 404 : 200, ok: true, json: async () => data };
  };
  const sandbox = { fetch: request, localStorage: storage, notify() {}, t: key => key, AbortSignal };
  const api = vm.runInNewContext(source + '; ({createPluginUpdater,selectPluginRelease,compareReleaseVersions})', sandbox);
  const controller = api.createPluginUpdater({ request, storage, current, changed() {}, now: () => 1000 });
  return { controller, api, calls, storage, request };
}
test('release selection ignores drafts, foreign archives and incomplete publications; compares numerically', () => {
  const { api } = fixture();
  const chosen = api.selectPluginRelease([release('0.1.9'), release('0.1.11'), release('0.1.12', { draft: true }),
    release('0.1.13', { assets: [] }), release('0.1.14', { assets: [{ name: 'dsh-external-dsh-plugin-local-ai-tts-0.1.14.tgz', browser_download_url: 'https://evil.example/file.tgz' }] })]);
  assert.equal(chosen.version, '0.1.11');
  assert.equal(chosen.candidate, true);
  assert.equal(api.compareReleaseVersions('0.1.10', '0.1.9'), 1);
});
test('automatic checks coalesce, persist a daily cache and never send credentials to GitHub', async () => {
  const h = fixture();
  await Promise.all([h.controller.check(), h.controller.check()]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.credentials, 'omit');
  const reopened = h.api.createPluginUpdater({ request: h.request, storage: h.storage, current: '0.1.10', changed() {}, now: () => 2000 });
  await reopened.check(); assert.equal(h.calls.length, 1);
  reopened.setAuto(false);
  assert.equal(h.api.createPluginUpdater({ storage: h.storage }).state.auto, false);
  await reopened.check(true); assert.equal(h.calls.length, 2);
});
test('declining an update does not mutate the profile, and duplicate install gestures coalesce', async () => {
  const h = fixture();
  assert.equal(await h.controller.install(() => false), false);
  assert.equal(h.calls.length, 1);
  const results = await Promise.all([h.controller.install(() => true), h.controller.install(() => true)]);
  assert.equal(results.filter(Boolean).length, 1);
  const writes = h.calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).restore, undefined);
  assert.equal(h.controller.state.installed, true);
  assert.equal(h.controller.state.current, '0.1.10', 'loaded version must not pretend to change before restart');
});
test('local archives delegate restoration to the market, while pinned online archives offer a source migration command', async () => {
  const local = fixture({ kind: 'linked' });
  assert.equal(await local.controller.install(() => true), true);
  assert.equal(JSON.parse(local.calls.at(-1).options.body).restore, true);
  const pinned = fixture({ kind: 'npm' });
  assert.equal(await pinned.controller.install(() => true), false);
  assert.equal(pinned.controller.state.error, 'update.sourceHelp');
  assert.equal(pinned.calls.some(call => call.options.method === 'POST'), false);
});
test('network failure, missing market and failed/stale/blocked installs never report success', async () => {
  for (const options of [{ failure: 'network' }, { failure: 'missing-market' }, { result: { ok: false } },
    { result: { ok: true, stale: true } }, { result: { ok: true, compatibility: { ok: false } } }]) {
    const h = fixture(options);
    assert.equal(await h.controller.install(() => true), false);
    assert.equal(h.controller.state.installed, false);
    assert.ok(h.controller.state.error);
  }
});
test('no downgrade or unnecessary install when the running version is already current', async () => {
  const h = fixture({ current: '0.1.12' });
  assert.equal(await h.controller.install(() => { throw new Error('must not confirm a downgrade'); }), false);
  assert.equal(h.calls.length, 1);
});
test('an already replaced package requests restart instead of running a stale update again', async () => {
  const h = fixture({ diskVersion: '0.1.11', updateAvailable: false });
  assert.equal(await h.controller.install(() => true), true);
  assert.equal(h.controller.state.installed, true);
  assert.equal(h.calls.some(call => call.options.method === 'POST'), false);
});
