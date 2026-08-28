import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverEngine } from '../lib/local-runtime/discovery.mjs';
import { registerLocalRuntime } from '../lib/local-runtime/service.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-discovery-'));
  t.after(async () => {
    // Delete only the exact test directory created above, never the temp root.
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('dsh-discovery-'));
    await rm(root, { recursive: true, force: true });
  });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}
const indexFiles = { 'indextts/infer_v2_5.py': 'DO NOT EXECUTE', '.venv/Scripts/python.exe': 'NOT AN EXECUTABLE', 'checkpoints/config.yaml': 'version: 2.5', 'examples/speaker.wav': 'NOT AUDIO' };
const gptFiles = { 'api_v2.py': 'DO NOT EXECUTE', 'runtime/python.exe': 'NOT AN EXECUTABLE', 'GPT_SoVITS/configs/tts_infer.yaml': 'custom: {}', 'ref_audios/speaker.wav': 'NOT AUDIO' };

test('Index discovery resolves quoted Unicode wrapper folder, no Python/audio/model loading', async t => {
  const root = await fixture(t, Object.fromEntries(Object.entries(indexFiles).map(([k, v]) => ['app/' + k, v])));
  await mkdir(path.join(root, 'app/voices/角色 A'), { recursive: true });
  const d = await discoverEngine({ engine: 'indextts', projectPath: ' "' + root + '" ' });
  assert.equal(d.config.projectPath, path.join(root, 'app'));
  assert.equal(d.config.pythonPath, path.join(root, 'app/.venv/Scripts/python.exe'));
  assert.equal(d.config.modelDir, path.join(root, 'app/checkpoints'));
  assert.equal(d.config.voice, path.join(root, 'app/examples/speaker.wav'));
  assert.deepEqual(d.warnings, []); assert.equal(d.layoutOnly, true);
});
test('GPT integrated package uses root API, runtime Python and default inference YAML', async t => {
  const root = await fixture(t, gptFiles);
  const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
  assert.equal(d.config.pythonPath, path.join(root, 'runtime/python.exe'));
  assert.equal(d.config.apiScript, path.join(root, 'api_v2.py'));
  assert.equal(d.config.ttsConfig, path.join(root, 'GPT_SoVITS/configs/tts_infer.yaml'));
  assert.equal(d.config.referenceAudio, d.config.voice); assert.deepEqual(d.warnings, []);
});

const character = { format_version: 1, name: '雷米埃尔', model_version: 'v2ProPlus', reference_audio: 'reference.wav',
  gpt_checkpoint: 'GPT_weights_v2ProPlus/雷米埃尔-e15.ckpt', sovits_checkpoint: 'SoVITS_weights_v2ProPlus/雷米埃尔_e8_s88.pth',
  prompt_text: '嗨，又见面了。', prompt_lang: 'zh', command: 'MUST NOT EXECUTE' };
const characterFiles = {
  'api_v2.py': 'DO NOT EXECUTE', 'GPT_SoVITS/configs/tts_infer.yaml': '', 'runtime/python.exe': 'NOT EXECUTABLE',
  'weight.json': JSON.stringify({ GPT: { v2: character.gpt_checkpoint }, SoVITS: {} }),
  'runtime_voices/雷米埃尔/voice.json': JSON.stringify(character), 'runtime_voices/雷米埃尔/reference.wav': 'NOT AUDIO',
  'runtime_voices/雷米埃尔/cache/conditioning.pt': 'MUST NOT DESERIALIZE',
  [character.gpt_checkpoint]: 'NOT WEIGHTS', [character.sovits_checkpoint]: 'NOT WEIGHTS',
  'GPT_weights_v2ProPlus/雷米埃尔-e5.ckpt': '', 'SoVITS_weights_v2ProPlus/雷米埃尔_e4_s44.pth': '',
};

test('GPT runtime_voices exposes the explicitly saved character pair without loading or choosing it', async t => {
  const root = await fixture(t, characterFiles);
  const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
  assert.equal(d.config.pythonPath, path.join(root, 'runtime/python.exe'));
  assert.equal(d.candidates.characters.length, 1);
  assert.equal(d.candidates.characters[0].name, '雷米埃尔');
  assert.deepEqual(d.candidates.characters[0].config, {
    referenceAudio: path.join(root, 'runtime_voices/雷米埃尔/reference.wav'),
    gptModel: path.join(root, character.gpt_checkpoint), sovitsModel: path.join(root, character.sovits_checkpoint),
    gptVersion: 'v2ProPlus', promptText: character.prompt_text, promptLang: 'zh',
  });
  for (const key of ['voice', 'referenceAudio', 'gptModel', 'sovitsModel']) assert.equal(d.config[key], undefined);
  assert.equal(d.candidates.voices[0].id, d.candidates.characters[0].config.referenceAudio);
  assert.ok(d.warnings.includes('SAVED_MODELS_INCOMPLETE'));
  assert.ok(d.warnings.includes('CHOOSE_CHARACTER')); assert.ok(!d.warnings.includes('REFERENCE_NOT_FOUND'));
});

test('GPT saved characters keep their own references and do not assume one character from multiple entries', async t => {
  const root = await fixture(t, { ...characterFiles,
    'runtime_voices/另一个角色/voice.json': '\uFEFF' + JSON.stringify({ ...character, name: '另一个角色', prompt_lang: 'ja', prompt_text: 'こんにちは。' }),
    'runtime_voices/另一个角色/reference.wav': '',
  });
  const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
  assert.equal(d.candidates.characters.length, 2);
  assert.equal(new Set(d.candidates.characters.map(v => v.config.referenceAudio)).size, 2);
  assert.equal(d.config.voice, undefined); assert.equal(d.config.gptModel, undefined);
});

test('GPT skips malformed, unsupported, missing and escaped character metadata without hiding ordinary references', async t => {
  const outside = await fixture(t, { 'outside.ckpt': '', 'outside.wav': '' });
  for (const overrides of [{ format_version: 2 }, { model_version: 'unknown' }, { prompt_text: '' },
    { gpt_checkpoint: 'missing.ckpt' }, { reference_audio: '../../escape.wav' },
    { gpt_checkpoint: path.join(outside, 'outside.ckpt') }, { reference_audio: 'https://example.test/ref.wav' }]) {
    const root = await fixture(t, { ...characterFiles, 'runtime_voices/雷米埃尔/voice.json': JSON.stringify({ ...character, ...overrides }) });
    const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
    assert.deepEqual(d.candidates.characters, []); assert.ok(d.warnings.includes('CHARACTER_PRESET_INVALID'));
    assert.equal(d.candidates.voices.length, 1);
  }
  const root = await fixture(t, { ...characterFiles, 'runtime_voices/雷米埃尔/voice.json': '{' + ' '.repeat(70000) + '}' });
  const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
  assert.deepEqual(d.candidates.characters, []); assert.ok(d.warnings.includes('CHARACTER_PRESET_INVALID'));
});

test('GPT metadata cannot reference linked checkpoints outside the project', async t => {
  const outside = await fixture(t, { 'outside.ckpt': '' });
  const root = await fixture(t, { ...characterFiles, 'runtime_voices/雷米埃尔/voice.json': JSON.stringify({ ...character, gpt_checkpoint: 'linked/outside.ckpt' }) });
  await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const d = await discoverEngine({ engine: 'gpt-sovits', projectPath: root });
  assert.deepEqual(d.candidates.characters, []); assert.ok(d.warnings.includes('CHARACTER_PRESET_INVALID'));
});
test('multiple Python/model/audio candidates remain explicit choices, including Unicode presets', async t => {
  const root = await fixture(t, { ...indexFiles, 'runtime/python.exe': '', 'checkpoints_25/config.yaml': 'version: "2.5"', 'outputs/presets/角色 A/prompt.wav': '' });
  const d = await discoverEngine({ engine: 'indextts', projectPath: root });
  for (const key of ['pythonPath', 'modelDir', 'voice']) assert.equal(d.config[key], undefined);
  assert.equal(d.candidates.voices.length, 2);
  for (const warning of ['MULTIPLE_PYTHONS', 'MULTIPLE_MODELS', 'CHOOSE_REFERENCE']) assert.ok(d.warnings.includes(warning));
});
test('missing files and IndexTTS 2 model config do not get a false 2.5 default', async t => {
  const root = await fixture(t, { 'indextts/infer_v2_5.py': '', 'checkpoints/config.yaml': 'version: 2' });
  const d = await discoverEngine({ engine: 'indextts', projectPath: root });
  assert.equal(d.config.modelDir, undefined);
  for (const warning of ['PYTHON_NOT_FOUND', 'OTHER_INDEX_VERSION', 'MODEL_NOT_FOUND', 'REFERENCE_NOT_FOUND']) assert.ok(d.warnings.includes(warning));
  const gpt = await fixture(t, { 'api_v2.py': '', 'GPT_SoVITS/README.md': '' });
  assert.ok((await discoverEngine({ engine: 'gpt-sovits', projectPath: gpt })).warnings.includes('TTS_CONFIG_NOT_FOUND'));
});
test('reject broad/relative/network/missing paths and ambiguous or wrong engine folders', async t => {
  for (const projectPath of ['', '.', '..', path.parse(process.cwd()).root, '\\\\server\\share', '//server/share', 'bad\npath', 'x'.repeat(4097)]) {
    await assert.rejects(discoverEngine({ engine: 'indextts', projectPath }), { code: 'PROJECT_PATH' });
  }
  const root = await fixture(t, { 'app/indextts/infer_v2_5.py': '', 'IndexTTS/indextts/infer_v2_5.py': '' });
  await assert.rejects(discoverEngine({ engine: 'indextts', projectPath: root }), { code: 'AMBIGUOUS_PROJECT' });
  await assert.rejects(discoverEngine({ engine: 'gpt-sovits', projectPath: root }), { code: 'ENGINE_NOT_FOUND' });
  await assert.rejects(discoverEngine({ engine: 'other', projectPath: root }), { code: 'ENGINE' });
  await assert.rejects(discoverEngine({ engine: 'indextts', projectPath: path.join(root, 'missing') }), { code: 'PROJECT_PATH' });
});
test('does not follow directory links outside root or scan unrelated/deep output directories', async t => {
  const root = await fixture(t, { ...indexFiles, 'unrelated/secret.wav': '', 'outputs/generated.wav': '', 'examples/a/b/c/too-deep.wav': '' });
  const outside = await fixture(t, { 'secret.wav': '' });
  await symlink(outside, path.join(root, 'voices'), process.platform === 'win32' ? 'junction' : 'dir');
  const d = await discoverEngine({ engine: 'indextts', projectPath: root });
  assert.deepEqual(d.candidates.voices.map(v => v.name), [path.join('examples', 'speaker.wav')]);
});
test('candidate list is bounded and warns on truncation', async t => {
  const root = await fixture(t, { ...indexFiles, ...Object.fromEntries(Array.from({ length: 110 }, (_, i) => ['voices/' + i + '.wav', ''])) });
  const d = await discoverEngine({ engine: 'indextts', projectPath: root });
  assert.equal(d.candidates.voices.length, 100); assert.ok(d.warnings.includes('AUDIO_LIST_TRUNCATED'));
});
test('discovery route is read-only, no configured client required, inherits same-origin restrictions', async t => {
  const root = await fixture(t, gptFiles), cleanup = []; let route;
  const service = registerLocalRuntime({ effect(fn) { const dispose = fn(); if (dispose) cleanup.push(dispose); } }, { register(r) { route = r; return () => {}; } });
  t.after(() => cleanup.reverse().forEach(fn => fn()));
  async function call(headers = {}) {
    let result, code;
    await route.handler({ method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost:1234', ...headers }, async *[Symbol.asyncIterator]() { yield JSON.stringify({ action: 'discover', engine: 'gpt-sovits', projectPath: root }); } }, { writeHead(status) { code = status; }, end(body) { result = JSON.parse(body); } });
    return { result, code };
  }
  assert.equal((await call()).code, 200);
  assert.equal((await call({ origin: 'http://evil.test' })).result.code, 'ORIGIN');
  assert.equal((await call({ 'sec-fetch-site': 'cross-site' })).result.code, 'ORIGIN');
  assert.equal(service.clients.size, 0); assert.equal(service.pool.entries.size, 0);
});
