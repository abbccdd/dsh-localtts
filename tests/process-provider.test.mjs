import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { ProcessTTSProvider, normalizeConfig } from '../lib/local-runtime/provider.mjs';

const worker = path.resolve('tests/fixtures/jsonl-worker.mjs');
const config = () => ({ mode: 'process', engine: 'indextts', command: process.execPath, args: [worker], voice: 'mock', startupTimeoutMs: 5000, timeoutMs: 3000 });

test('built-in IndexTTS recipe constructs explicit worker arguments', () => {
  const c = normalizeConfig({ mode: 'process', engine: 'indextts', pythonPath: 'python-custom', projectPath: 'index-tts-project', modelDir: 'index-tts-project/checkpoints', presetsRoot: 'voice-presets', device: 'cuda:0', voice: 'voice-presets/demo.wav' });
  assert.equal(c.command, 'python-custom');
  assert.equal(c.cwd, 'index-tts-project');
  assert.deepEqual(c.args.slice(1), ['--project-path', 'index-tts-project', '--model-dir', 'index-tts-project/checkpoints', '--lang', 'ZH', '--duration-factor', '1', '--presets-root', 'voice-presets', '--device', 'cuda:0', '--voice', 'voice-presets/demo.wav']);
  assert.match(c.args[0], /adapters[\\/]index-tts-worker\.py$/);
});

test('built-in GPT-SoVITS recipe constructs api_v2 worker arguments', () => {
  const c = normalizeConfig({ mode: 'process', engine: 'gpt-sovits', pythonPath: 'python-custom', projectPath: 'gpt-sovits-project', apiScript: 'gpt-sovits-project/api_v2.py', referenceAudio: 'voice-presets/demo.wav', promptText: '你好', promptLang: 'zh', textLang: 'zh', port: 9988, ttsConfig: 'gpt-sovits-project/configs/tts_infer.yaml' });
  assert.equal(c.command, 'python-custom');
  assert.equal(c.voice, 'voice-presets/demo.wav');
  assert.deepEqual(c.args.slice(1), ['--api-script', 'gpt-sovits-project/api_v2.py', '--project-path', 'gpt-sovits-project', '--ref-audio', 'voice-presets/demo.wav', '--prompt-text', '你好', '--prompt-lang', 'zh', '--text-lang', 'zh', '--speed-factor', '1', '--port', '9988', '--tts-config', 'gpt-sovits-project/configs/tts_infer.yaml']);
  assert.match(c.args[0], /adapters[\\/]gpt-sovits-worker\.py$/);
});

test('model speed controls are bounded and normalized', () => {
  const index = normalizeConfig({ mode: 'process', engine: 'indextts', projectPath: 'p', modelDir: 'm', voice: 'v', durationFactor: 1.25 });
  assert.equal(index.durationFactor, 1.25); assert.equal(index.speedFactor, 1);
  const gpt = normalizeConfig({ mode: 'process', engine: 'gpt-sovits', projectPath: 'p', apiScript: 'p/api_v2.py', referenceAudio: 'v', speedFactor: 1.4 });
  assert.equal(gpt.speedFactor, 1.4); assert.equal(gpt.durationFactor, 1);
  for (const [key, value] of [['durationFactor', 0.49], ['durationFactor', 2.01], ['speedFactor', 0.59], ['speedFactor', 1.66]])
    assert.throws(() => normalizeConfig({ mode: 'process', engine: 'indextts', projectPath: 'p', modelDir: 'm', voice: 'v', [key]: value }), { code: 'SPEED_CONFIG' });
});

test('process provider starts JSONL worker, checks health/voices and synthesizes', async () => {
  const p = new ProcessTTSProvider(config());
  try {
    assert.deepEqual(normalizeConfig(config()).mode, 'process');
    assert.equal((await p.healthCheck()).ready, true);
    assert.deepEqual((await p.listVoices()).voices[0].id, 'mock');
    const a = await p.synthesize({ text: '第一句。', voice: 'mock' });
    assert.equal(a.mime, 'audio/wav'); assert.equal(a.data.subarray(0, 4).toString(), 'RIFF');
  } finally { p.dispose(); }
});

test('process provider sends one request per sentence through service provider boundary', async () => {
  const p = new ProcessTTSProvider({ ...config(), engine: 'gpt-sovits' });
  try { const results = await Promise.all(['第一句。', '第二句！', 'Third?'].map(text => p.synthesize({ text }))); assert.equal(results.length, 3); }
  finally { p.dispose(); }
});

test('process provider rejects invalid command and cancellation is recoverable', async () => {
  const p = new ProcessTTSProvider({ ...config(), command: path.resolve('tests/fixtures/does-not-exist') });
  await assert.rejects(() => p.healthCheck(), /Cannot start|failed to start|exited/i);
  p.dispose();
});

test('official WebUI recipes use an existing Python, with strict local endpoint and no BAT', () => {
  const c = normalizeConfig({ mode: 'process', launchPreset: 'webui', webuiMode: 'attach', webuiEndpoint: 'http://localhost:8765', voice: '/fixture/ref.wav', pythonPath: 'existing-python' });
  assert.equal(c.command, 'existing-python'); assert.equal(c.webuiEndpoint, 'http://127.0.0.1:8765');
  assert.match(c.args[0], /gradio-worker\.py$/); assert.ok(c.args.includes('attach'));
  assert.ok(!c.args.some(a => a.endsWith('.bat')));
  for (const webuiEndpoint of ['https://example.com', 'http://192.168.1.2', 'http://u:p@localhost', 'http://localhost/?token=a'])
    assert.throws(() => normalizeConfig({ ...c, webuiEndpoint }));
  assert.throws(() => normalizeConfig({ ...c, webuiMode: 'auto' }), { code: 'PROJECT_PATH' });
});

test('not-ready health is rejected and spawned worker is reaped', async () => {
  const p = new ProcessTTSProvider({ ...config(), args: [worker, '--not-ready'] });
  await assert.rejects(p.healthCheck(), { code: 'NOT_READY' });
  assert.equal(p.child, null); await p.dispose();
});

test('concurrent calls wait for delayed readiness and reuse the same child', async () => {
  const p = new ProcessTTSProvider({ ...config(), args: [worker, '--slow-ready'] });
  try {
    const started = Date.now();
    await Promise.all([p.healthCheck(), p.synthesize({ text: '句。' })]);
    assert.ok(Date.now() - started >= 80);
    const child = p.child;
    await p.synthesize({ text: '下句。' }); assert.equal(p.child, child);
  } finally { await p.dispose(); }
});
