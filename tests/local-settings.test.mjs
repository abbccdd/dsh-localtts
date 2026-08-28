import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/local-client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const requests = [], saves = [], errors = [], hooks = []; let cursor = 0, controller;
  const shared = { provider: 'indextts-process', autoRead: false };
  const deps = {
    shared, window: { __dshLocalAiTtsI18n: { current: () => 'en' } },
    react: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(v => v != null && v !== false) }),
      useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }]; },
      useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; }, useEffect() {},
    }, slots: { inject() {} }, ctx: { effect() {} }, useSharedForce() {}, notify() {}, localAutoAllowed: () => true,
    stopSpeaking() { controller.stop(); }, showToast: m => errors.push(m),
    saveSettings() { saves.push(JSON.parse(JSON.stringify(shared))); controller.sync(); },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      if (payload.action !== 'discover' && payload.action !== 'status') { requests.push({ payload }); return { ok: true, json: async () => ({ ok: true }) }; }
      return new Promise(resolve => requests.push({ payload, finish(data, ok = true) { resolve({ ok, json: async () => data }); } }));
    },
  };
  controller = new Function('deps', `with(deps) { ${source}; return createLocalController(); }`)(deps);
  return { controller, shared, requests, saves, errors, render() { cursor = 0; return controller.Settings(); } };
}
const found = (project = '/fixture/project', extra = {}) => ({ config: { projectPath: project, pythonPath: project + '/python', modelDir: project + '/checkpoints', voice: project + '/speaker.wav', ...extra }, candidates: { pythonPath: [], modelDir: [], voices: [] }, warnings: [], layoutOnly: true });
const flatten = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : [];
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');

test('discovery fills gaps, saves the result, and deduplicates blur/button requests', async () => {
  const h = harness(); h.controller.updateSetting('projectPath', '/fixture');
  const a = h.controller.discover(), b = h.controller.discover(); assert.equal(a, b);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].payload.action, 'discover');
  h.requests[0].finish(found()); await a; await flush();
  assert.equal(h.shared.localProcess.projectPath, '/fixture/project');
  assert.equal(h.shared.localProcess.pythonPath, '/fixture/project/python');
  assert.equal(h.saves.at(-1).localProcess.voice, '/fixture/project/speaker.wav');
  assert.equal(h.requests.filter(r => r.payload.action === 'configure').length, 1);
  assert.equal(h.errors.length, 0);
});
test('rescanning same project preserves manually configured external files', async () => {
  const h = harness(); Object.assign(h.shared.localProcess, { projectPath: '/fixture/project', pythonPath: '/external/python', modelDir: '/external/models', voice: '/external/voice.wav' });
  const p = h.controller.discover(); h.requests[0].finish(found()); await p;
  assert.equal(h.shared.localProcess.pythonPath, '/external/python'); assert.equal(h.shared.localProcess.modelDir, '/external/models'); assert.equal(h.shared.localProcess.voice, '/external/voice.wav');
});
test('changing project clears stale launch fields, not common timeouts', () => {
  const h = harness(); Object.assign(h.shared.localProcess, { projectPath: '/old', pythonPath: '/old/python', modelDir: '/old/models', voice: '/old/ref.wav', command: '/old/python', args: ['old.py'], cwd: '/old', promptText: 'old transcript', timeoutMs: 42000, endpoint: 'http://localhost:9999' });
  h.controller.updateSetting('projectPath', '/new');
  for (const key of ['pythonPath', 'modelDir', 'command', 'cwd', 'promptText']) assert.equal(h.shared.localProcess[key], '');
  assert.deepEqual(h.shared.localProcess.args, []); assert.equal(h.shared.localProcess.voice, 'default');
  assert.equal(h.shared.localProcess.endpoint, undefined); assert.equal(h.shared.localProcess.timeoutMs, 42000);
});
test('engine selection saves provider and engine atomically and clears old paths', async () => {
  const h = harness(); h.shared.localProcess.projectPath = '/old'; h.shared.localProcess.modelDir = '/old/models';
  h.controller.selectEngine('gpt-sovits');
  assert.equal(h.saves.at(-1).provider, 'gpt-sovits-process'); assert.equal(h.saves.at(-1).localProcess.engine, 'gpt-sovits');
  assert.equal(h.shared.localProcess.projectPath, ''); assert.equal(h.shared.localProcess.modelDir, '');
  h.controller.updateSetting('referenceAudio', '/fixture/a.wav'); assert.equal(h.shared.localProcess.voice, '/fixture/a.wav');
  h.controller.updateSetting('voice', '/fixture/b.wav'); assert.equal(h.shared.localProcess.referenceAudio, '/fixture/b.wav');
  await flush(); assert.equal(h.requests.length, 0);
});
test('an incomplete new project disables the previous Host Auto Read snapshot', async () => {
  const h = harness(); h.shared.autoRead = true; Object.assign(h.shared.localProcess, found().config);
  h.controller.sync(); await flush();
  assert.equal(h.requests.at(-1).payload.autoRead, true);
  h.controller.updateSetting('projectPath', '/incomplete'); await flush();
  const configRequests = h.requests.filter(r => r.payload.action === 'configure');
  assert.equal(configRequests.at(-1).payload.autoRead, false);
  assert.equal(configRequests.at(-1).payload.config.projectPath, '/fixture/project');
  assert.equal(h.errors.length, 0);
});
test('stale scan cannot refill after project/engine/reset/manual edits, even on error', async () => {
  for (const mutate of [h => h.controller.updateSetting('projectPath', '/different'), h => h.controller.selectEngine('gpt-sovits'), h => { h.shared.localProcess = { ...h.controller.defaults }; }, h => h.controller.updateSetting('pythonPath', '/manual/python'), h => { h.shared.provider = 'edge-tts'; }]) {
    const h = harness(); h.shared.localProcess.projectPath = '/fixture';
    const p = h.controller.discover(); mutate(h); const before = JSON.stringify(h.shared.localProcess);
    h.requests[0].finish(found()); assert.equal(await p, null); assert.equal(JSON.stringify(h.shared.localProcess), before);
  }
  const h = harness(); h.shared.localProcess.projectPath = '/fixture'; const p = h.controller.discover(); h.controller.selectEngine('gpt-sovits');
  h.requests[0].finish({ error: 'stale error' }, false); assert.equal(await p, null);
});
test('missing and ambiguous candidates never invent required files or configure incomplete settings', async () => {
  const h = harness(); h.controller.updateSetting('projectPath', '/fixture');
  const p = h.controller.discover(); h.requests[0].finish({ config: { projectPath: '/fixture' }, candidates: { voices: [{ id: '/fixture/a.wav', name: 'a' }, { id: '/fixture/b.wav', name: 'b' }] }, warnings: ['MULTIPLE_MODELS', 'CHOOSE_REFERENCE'] });
  await p; await flush(); assert.equal(h.shared.localProcess.modelDir, ''); assert.equal(h.shared.localProcess.voice, 'default');
  assert.equal(h.requests.length, 1); assert.equal(h.errors.length, 0);
});
test('main UI contains only engine/project/reference; advanced options are collapsed', () => {
  const h = harness(), panel = h.render(), all = flatten(panel), details = all.find(n => n.type === 'details');
  const visible = flatten({ children: panel.children.filter(n => n !== details) });
  assert.ok(details && !details.props.open);
  assert.equal(visible.filter(n => n.type === 'input').length, 3);
  assert.equal(visible.filter(n => n.type === 'select').length, 2);
  assert.ok(text(panel).includes('Output language')); assert.ok(text(panel).includes('Duration factor'));
  const language = visible.find(n => n.type === 'select' && text(n).includes('Chinese'));
  language.props.onChange({ target: { value: 'EN' } });
  assert.equal(h.shared.localProcess.textLang, 'EN');
  const duration = visible.find(n => n.type === 'input' && n.props.type === 'range');
  duration.props.onChange({ target: { value: '1.25' } });
  assert.equal(h.shared.localProcess.durationFactor, 1.25);
  assert.ok(text(details).includes('Python executable')); assert.ok(text(details).includes('model directory'));
  assert.ok(!visible.some(n => n.type === 'input' && n.props.value === 'default'));
  const engine = visible.find(n => n.type === 'select'); engine.props.onChange({ target: { value: 'gpt-sovits' } });
  assert.equal(h.saves.at(-1).provider, 'gpt-sovits-process');
  assert.ok(text(h.render()).includes('Reference transcript'));
});
test('UI blur detects files, displays candidate selection and connects the selected reference', async () => {
  const h = harness(); let nodes = flatten(h.render());
  nodes.find(n => n.type === 'input' && n.props.onBlur).props.onChange({ target: { value: '/fixture' } });
  nodes = flatten(h.render()); const scan = nodes.find(n => n.type === 'input' && n.props.onBlur).props.onBlur();
  h.requests[0].finish({ ...found(), candidates: { voices: [{ id: '/fixture/a.wav', name: 'A' }, { id: '/fixture/b.wav', name: 'B' }] } });
  await scan;
  nodes = flatten(h.render()); const select = nodes.find(n => n.type === 'select' && text(n).includes('Choose audio'));
  select.props.onChange({ target: { value: '/fixture/b.wav' } }); assert.equal(h.shared.localProcess.voice, '/fixture/b.wav');
});

test('IndexTTS preset candidates are selectable by character name and keep the prompt path internally', async () => {
  const h = harness(); h.controller.updateSetting('projectPath', '/fixture');
  const p = h.controller.discover();
  h.requests[0].finish({ ...found(), candidates: { voices: [
    { id: '/fixture/outputs/presets/雷米埃尔/prompt.wav', name: 'outputs/presets/雷米埃尔/prompt.wav' },
    { id: '/fixture/examples/voice_01.wav', name: 'examples/voice_01.wav' },
  ] } });
  await p;
  const nodes = flatten(h.render());
  const roles = nodes.find(n => n.type === 'select' && text(n).includes('saved character voice'));
  assert.ok(roles);
  assert.ok(text(roles).includes('雷米埃尔'));
  roles.props.onChange({ target: { value: '/fixture/outputs/presets/雷米埃尔/prompt.wav' } });
  assert.equal(h.shared.localProcess.voice, '/fixture/outputs/presets/雷米埃尔/prompt.wav');
  assert.ok(text(h.render()).includes('Other detected reference audio'));
});

const savedGptCharacter = { id: '/fixture/runtime_voices/雷米埃尔/voice.json', name: '雷米埃尔', config: {
  referenceAudio: '/fixture/runtime_voices/雷米埃尔/reference.wav', gptVersion: 'v2ProPlus',
  gptModel: '/fixture/GPT_weights_v2ProPlus/remiel-e15.ckpt', sovitsModel: '/fixture/SoVITS_weights_v2ProPlus/remiel-e8.pth',
  promptText: '嗨，又见面了。', promptLang: 'zh',
} };
const foundGptCharacter = () => ({ config: { projectPath: '/fixture', pythonPath: '/fixture/runtime/python' },
  candidates: { characters: [savedGptCharacter], voices: [{ id: savedGptCharacter.config.referenceAudio, name: 'runtime_voices/雷米埃尔/reference.wav' }] },
  warnings: ['SAVED_MODELS_INCOMPLETE', 'CHOOSE_CHARACTER'], layoutOnly: true });

test('GPT character UI commits weights, transcript and reference together, preserving output preferences', async () => {
  const h = harness(); h.controller.selectEngine('gpt-sovits'); h.controller.updateSetting('projectPath', '/fixture');
  Object.assign(h.shared.localProcess, { textLang: 'ja', promptLang: 'en', speedFactor: 1.2 });
  const p = h.controller.discover(); h.requests[0].finish(foundGptCharacter()); await p; await flush();
  assert.equal(h.requests.filter(r => r.payload.action === 'configure').length, 0);
  const roles = flatten(h.render()).find(n => n.type === 'select' && text(n).includes('雷米埃尔'));
  assert.ok(roles); assert.equal(roles.props.value, '');
  const savesBefore = h.saves.length;
  roles.props.onChange({ target: { value: savedGptCharacter.id } }); await flush();
  assert.equal(h.saves.length, savesBefore + 1);
  for (const [key, value] of Object.entries(savedGptCharacter.config)) assert.equal(h.shared.localProcess[key], value);
  assert.equal(h.shared.localProcess.voice, savedGptCharacter.config.referenceAudio);
  assert.equal(h.shared.localProcess.textLang, 'ja'); assert.equal(h.shared.localProcess.speedFactor, 1.2);
  const sent = h.requests.filter(r => r.payload.action === 'configure').at(-1).payload.config;
  assert.equal(sent.gptModel, savedGptCharacter.config.gptModel); assert.equal(sent.sovitsModel, savedGptCharacter.config.sovitsModel);
  assert.equal(sent.promptText, savedGptCharacter.config.promptText);
  assert.ok(!text(h.render()).includes('weight.json has no complete'));
  assert.ok(!text(h.render()).includes('Choose audio /'));
  h.controller.updateSetting('promptText', 'manual text');
  assert.equal(flatten(h.render()).find(n => n.type === 'select' && text(n).includes('雷米埃尔')).props.value, '');
  const rescan = h.controller.discover(); h.requests.at(-1).finish(foundGptCharacter()); await rescan;
  assert.equal(h.shared.localProcess.promptText, 'manual text');
});

test('GPT selection invalidates late scans and is unavailable after changing project or to the independent API', async () => {
  const h = harness(); h.controller.selectEngine('gpt-sovits'); h.controller.updateSetting('projectPath', '/fixture');
  const p = h.controller.discover(); h.requests[0].finish(foundGptCharacter()); await p;
  assert.equal(h.controller.selectCharacter('/unknown'), false);
  const late = h.controller.discover(), request = h.requests.at(-1);
  assert.equal(h.controller.selectCharacter(savedGptCharacter.id), true);
  request.finish(found('/fixture', { voice: '/wrong.wav' })); assert.equal(await late, null);
  assert.equal(h.shared.localProcess.referenceAudio, savedGptCharacter.config.referenceAudio);
  h.controller.updateSetting('launchPreset', 'builtin');
  assert.equal(h.controller.selectCharacter(savedGptCharacter.id), false);
  h.controller.updateSetting('projectPath', '/another');
  assert.equal(h.controller.selectCharacter(savedGptCharacter.id), false);
  for (const key of ['referenceAudio', 'gptModel', 'sovitsModel', 'gptVersion', 'promptText']) assert.equal(h.shared.localProcess[key], '');
});
test('connection result is ignored if provider changes while testing', async () => {
  const h = harness(); Object.assign(h.shared.localProcess, found().config);
  const button = flatten(h.render()).find(n => n.type === 'button' && text(n) === 'Test Connection');
  const p = button.props.onClick(); h.shared.provider = 'gpt-sovits-process';
  h.requests[0].finish({ ready: true, supported: true, voices: [{ id: '/old/voice', name: 'Stale' }] });
  await p; assert.ok(!text(h.render()).includes('Stale')); assert.ok(!text(h.render()).includes('Worker responded'));
});

test('official background default and attach-only mode preserve voice while clearing legacy commands', async () => {
  const h = harness();
  assert.equal(h.shared.localProcess.launchPreset, 'webui');
  const details = flatten(h.render()).find(n => n.type === 'details');
  assert.ok(text(details).includes('no browser required'));
  Object.assign(h.shared.localProcess, { command: '/old/worker', args: ['old'], cwd: '/old', voice: '/ref.wav' });
  h.controller.updateSetting('launchPreset', 'builtin');
  h.controller.updateSetting('launchPreset', 'webui');
  h.controller.updateSetting('webuiMode', 'attach');
  h.controller.updateSetting('webuiEndpoint', 'http://127.0.0.1:9899');
  await flush();
  const cfg = h.requests.filter(r => r.payload.action === 'configure').at(-1).payload.config;
  assert.equal(cfg.command, ''); assert.deepEqual(cfg.args, []); assert.equal(cfg.voice, '/ref.wav');
  assert.equal(cfg.projectPath, ''); assert.equal(cfg.webuiMode, 'attach');
  assert.ok(text(h.render()).includes('never start or stop its model'));
});
