import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const pythonCandidates = [
  process.env.DSH_GRADIO_PYTHON,
  path.resolve('app/.venv/Scripts/python.exe'),
  path.resolve('../app/.venv/Scripts/python.exe'),
  'python',
].filter(Boolean);
const python = pythonCandidates.find(candidate => candidate === 'python' || existsSync(candidate));
if (!python) throw new Error('No Python executable found. Set DSH_GRADIO_PYTHON to the existing Gradio environment.');
const fixture = path.resolve('tests/fixtures/gradio-official-shape.py');
const ref = path.resolve('tests/fixtures/reference.wav');
const { writeFileSync } = await import('node:fs');
const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(44, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(0, 40);
// This ignored fixture is deliberately generated only for the local smoke.
writeFileSync(ref, h);
const worker = path.resolve('adapters/gradio-worker.py');
async function run(engine, variant) {
  const port = 57981 + run.counter++;
  const env = { ...process.env, PYTHONUTF8: '1', GRADIO_ANALYTICS_ENABLED: 'False', DSH_TTS_DEBUG: '1' };
  const server = spawn(python, [fixture, '--engine', engine, '--variant', variant, '--port', String(port)], { stdio: ['ignore', 'inherit', 'inherit'], cwd: process.cwd(), env });
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try { const response = await fetch(`http://127.0.0.1:${port}/config`); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const child = spawn(python, [worker, '--engine', engine, '--connection', 'attach', '--endpoint', `http://127.0.0.1:${port}`, '--ref-audio', ref, '--variant', variant, '--prompt-lang', 'zh', '--text-lang', 'zh'], { stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd(), env });
  const lines = []; child.stdout.setEncoding('utf8'); child.stdout.on('data', d => lines.push(...d.split(/\r?\n/).filter(Boolean)));
  try {
    const send = (id, action, extra={}) => { child.stdin.write(JSON.stringify({id, action, ...extra})+'\n'); return new Promise(async (resolve, reject) => { const until=Date.now()+30000; while (Date.now()<until) { const line=lines.shift(); if (line) { const r=JSON.parse(line); if (r.id===id) return r.ok ? resolve(r) : reject(new Error(JSON.stringify(r))); } await new Promise(r=>setTimeout(r,20)); } reject(new Error('worker timeout')); }); };
    const health = await send('h','health'); assert.equal(health.ready, true); assert.match(health.api, /^\/(gen_single|get_tts_wav|inference)$/);
    const audio = await send('s','synthesize',{text:'测试。'}); assert.equal(audio.mime,'audio/wav'); assert.ok(Buffer.from(audio.audioBase64,'base64').subarray(0,4).toString()==='RIFF');
    child.stdin.end(); await new Promise(resolve => child.once('exit', resolve));
  } finally {
    if (child.exitCode===null) child.kill();
    if (server.exitCode===null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  }
}
run.counter = 0;
try { await run('indextts','standard'); await run('gpt-sovits','standard'); await run('gpt-sovits','fast'); console.log('Gradio official-shape smoke passed (fixture only).'); }
finally { try { (await import('node:fs/promises')).unlink(ref); } catch {} }
