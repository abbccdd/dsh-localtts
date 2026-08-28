// Real HTTP smoke only. Does not start a Runtime, save audio, or claim browser playback.
import { createProvider } from '../lib/local-runtime/provider.mjs';
import { sentences } from '../lib/local-runtime/sentence-buffer.mjs';
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.endpoint || !['indextts', 'gpt-sovits'].includes(args.engine)) {
  console.error('Usage: node tools/smoke-runtime.mjs --engine indextts|gpt-sovits --endpoint http://127.0.0.1:<port> [--voice default] [--protocol runtime-v1|openai-speech]');
  process.exitCode = 2;
} else {
  const provider = createProvider({ endpoint: args.endpoint, engine: args.engine, voice: args.voice || 'default', protocol: args.protocol || 'auto', timeoutMs: 300000 });
  try {
    const health = await provider.healthCheck();
    if (!health.ready) throw new Error(`Runtime not ready: ${health.status}`);
    const voices = await provider.listVoices(); console.log(JSON.stringify({ health, voiceDiscovery: voices.supported, voiceCount: voices.voices.length }));
    let requests = 0;
    for (const text of sentences('第一句，这是连接测试。第二句，正在逐句合成。第三句，测试结束。')) {
      const audio = await provider.synthesize({ text }); requests++;
      console.log(JSON.stringify({ request: requests, bytes: audio.data.length, mime: audio.mime }));
    }
    if (requests !== 3) throw new Error('Expected exactly three requests.');
    console.log('PASS: three real HTTP syntheses. Harness/browser playback still requires separate acceptance.');
  } catch (e) { console.error(JSON.stringify({ status: 'FAIL', code: e.code || 'SMOKE', error: e.message })); process.exitCode = 1; }
  finally { provider.cancel(); }
}
