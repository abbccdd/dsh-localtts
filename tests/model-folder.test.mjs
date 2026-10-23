import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverModelFolder, browseModelFolders } from '../lib/local-runtime/model-discovery.mjs';
import { normalizeConfig } from '../lib/local-runtime/provider.mjs';

async function fixture() {
  const tmp = new URL('../tmp/', import.meta.url); await mkdir(tmp, { recursive: true });
  return mkdtemp(path.join(tmp.pathname.replace(/^\/(\w:)/, '$1'), 'folder-'));
}
async function files(folder, entries) {
  for (const [name, data] of Object.entries(entries)) { const file = path.join(folder, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data)); }
}
test('folder discovery reads known model metadata and lists local preset voices without starting Python', async () => {
  const root = await fixture();
  await files(root, { 'kokoro/config.json': {}, 'kokoro/kokoro-v1_0.pth': '', 'kokoro/voices/zf_xiaobei.pt': '', 'kokoro/voices/notes.txt': '', 'kokoro-runtime/Scripts/python.exe': '', 'kokoro-runtime/bin/python': '',
    'qwen/config.json': { model_type: 'qwen3_tts', tts_model_type: 'custom_voice', talker_config: { spk_id: { vivian: 1, ryan: 2 } } }, 'qwen/model.safetensors': '' });
  const result = await discoverModelFolder({ modelDir: root });
  assert.equal(result.models.length, 2);
  const kokoro = result.models.find(m => m.config.modelType === 'kokoro');
  assert.equal(kokoro.config.voice, 'zf_xiaobei'); assert.equal(kokoro.needsReference, false); assert.ok(kokoro.config.pythonPath);
  assert.deepEqual(result.models.find(m => m.config.modelType === 'qwen3').voices.map(v => v.id), ['ryan', 'vivian']);
  const browsing = await browseModelFolders({ folder: root });
  assert.ok(browsing.folders.some(f => f.name === 'qwen')); assert.equal(browsing.parent, path.dirname(root));
});
test('cloning folder presets require contained reference files, and unknown weights are never guessed', async () => {
  const root = await fixture();
  await files(root, { 'model_1250000.safetensors': '', 'vocab.txt': '', 'ref.wav': '', 'dsh-voices.json': { voices: [{ id: 'speaker', referenceAudio: 'ref.wav', promptText: '原文' }] } });
  const model = (await discoverModelFolder({ modelDir: root })).models[0];
  assert.equal(model.needsReference, true); assert.equal(model.referenceVoices[0].referenceAudio, path.join(root, 'ref.wav'));
  const outside = path.join(path.dirname(root), 'outside.wav'); await writeFile(outside, '');
  await files(root, { 'dsh-voices.json': { voices: [{ id: 'bad', referenceAudio: '../outside.wav', promptText: '原文' }] } });
  await assert.rejects(discoverModelFolder({ modelDir: root }), /必须位于/);
  const unknown = await fixture(); await files(unknown, { 'model.safetensors': '', 'config.json': { model_type: 'unknown' } });
  await assert.rejects(discoverModelFolder({ modelDir: unknown }), /未识别/);
  await assert.rejects(discoverModelFolder({ modelDir: 'relative' }), /完整路径/);
});
test('folder recipe is normalized idempotently and cloning is blocked before spawning without reference', () => {
  const config = { engine: 'folder', mode: 'process', launchPreset: 'folder', modelType: 'qwen3', modelDir: '/models/qwen', pythonPath: '/env/python', voice: 'vivian' };
  const normalized = normalizeConfig(config);
  assert.deepEqual(normalizeConfig(normalized), normalized);
  assert.ok(normalized.args[0].endsWith('model-folder-worker.py')); assert.equal(normalized.command, '/env/python');
  assert.throws(() => normalizeConfig({ ...config, modelType: 'f5' }), /参考音频/);
  assert.throws(() => normalizeConfig({ ...config, launchPreset: 'custom' }), /文件夹/);
  assert.throws(() => normalizeConfig({ ...config, modelType: 'unknown' }), /识别/);
});
