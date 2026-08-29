import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { sentences } from './sentence-buffer.mjs';
import { spawn } from 'node:child_process';
import { randomUUID as randomUuidProcess } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export class RuntimeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new RuntimeError(code, message); };
export const DEFAULTS = Object.freeze({ engine: 'indextts', endpoint: '', voice: 'default', protocol: 'auto', timeoutMs: 120000, allowLan: false, debug: false });

// Process mode is deliberately a small, stable JSONL boundary. The child is
// user-owned (for example an IndexTTS or GPT-SoVITS adapter) and remains
// responsible for loading models. The plugin only starts it and sends one
// sentence per request; it never imports or mutates a model implementation.
export const PROCESS_DEFAULTS = Object.freeze({
  mode: 'process', launchPreset: 'builtin', engine: 'indextts', pythonPath: '', projectPath: '',
  modelDir: '', presetsRoot: '', device: '', apiScript: '', ttsConfig: '', referenceAudio: '', promptText: '',
  webuiMode: 'auto', webuiEndpoint: '', webuiVariant: 'standard', gptVersion: '', gptModel: '', sovitsModel: '',
  promptLang: 'zh', textLang: 'zh', durationFactor: 1, speedFactor: 1, port: 9880, command: '', args: [], cwd: '', voice: 'default',
  startupTimeoutMs: 300000, timeoutMs: 180000, autoStart: true, debug: false
});

function processConfig(value = {}) {
  const c = { ...PROCESS_DEFAULTS, ...value };
  if (value.launchPreset === undefined && (value.command || (Array.isArray(value.args) && value.args.length))) c.launchPreset = 'custom';
  if (!['indextts', 'gpt-sovits'].includes(c.engine)) fail('ENGINE', 'Unsupported engine.');
  if (!['builtin', 'custom', 'webui'].includes(c.launchPreset)) fail('LAUNCH_PRESET', 'Unsupported local launch preset.');
  if (typeof c.voice !== 'string' || !c.voice.trim() || c.voice.length > 256) fail('VOICE', 'Voice must be a non-empty ID (up to 256 characters).');
  for (const key of ['pythonPath', 'projectPath', 'modelDir', 'presetsRoot', 'device', 'apiScript', 'ttsConfig', 'referenceAudio', 'promptText', 'promptLang', 'textLang', 'cwd', 'webuiEndpoint', 'gptVersion', 'gptModel', 'sovitsModel'])
    if (typeof c[key] !== 'string' || c[key].length > 4096 || c[key].includes('\0')) fail('PATH_CONFIG', `${key} is invalid.`);
  const durationFactor = Number(c.durationFactor), speedFactor = Number(c.speedFactor);
  if (!Number.isFinite(durationFactor) || durationFactor < 0.5 || durationFactor > 2)
    fail('SPEED_CONFIG', 'IndexTTS duration factor must be between 0.50 and 2.00.');
  if (!Number.isFinite(speedFactor) || speedFactor < 0.6 || speedFactor > 1.65)
    fail('SPEED_CONFIG', 'GPT-SoVITS speed factor must be between 0.60 and 1.65.');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) fail('PORT', 'Port must be between 1024 and 65535.');
  let command = String(c.command || c.pythonPath || 'python').trim();
  let voice = c.voice.trim();
  let args = c.args;
  if (c.launchPreset === 'webui') {
    if (!['auto', 'attach'].includes(c.webuiMode) || !['standard', 'fast'].includes(c.webuiVariant)) fail('WEBUI_CONFIG', 'Unsupported WebUI connection mode or variant.');
    if (c.webuiMode === 'auto' && !c.projectPath.trim()) fail('PROJECT_PATH', 'Select the existing official engine project directory.');
    if (c.webuiEndpoint.trim()) {
      let url;
      try { url = new URL(c.webuiEndpoint.trim()); } catch { fail('ENDPOINT', 'Enter a loopback WebUI HTTP(S) address.'); }
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash || /[\\\x00-\x20]/.test(c.webuiEndpoint))
        fail('ENDPOINT', 'WebUI address must be loopback HTTP(S), without credentials, query or fragment.');
      url.hostname = '127.0.0.1'; c.webuiEndpoint = url.toString().replace(/\/+$/, '');
    } else if (c.webuiMode === 'attach') fail('ENDPOINT', 'Enter the running inference WebUI address.');
    const reference = c.engine === 'gpt-sovits' ? c.referenceAudio.trim() : voice;
    if (!reference || reference === 'default') fail('VOICE', 'Select the reference audio file.');
    voice = reference; command = c.pythonPath.trim() || 'python';
    args = [fileURLToPath(new URL('../../adapters/gradio-worker.py', import.meta.url)), '--engine', c.engine,
      '--connection', c.webuiMode, '--endpoint', c.webuiEndpoint, '--project-path', c.projectPath,
      '--model-dir', c.modelDir, '--variant', c.webuiVariant, '--gpt-version', c.gptVersion,
      '--gpt-model', c.gptModel, '--sovits-model', c.sovitsModel, '--ref-audio', reference,
      '--prompt-text', c.promptText, '--prompt-lang', c.promptLang, '--text-lang', c.textLang,
      '--duration-factor', String(durationFactor), '--speed-factor', String(speedFactor)];
  }
  if (c.launchPreset === 'builtin') {
    if (!c.projectPath) fail('PROJECT_PATH', 'Select the existing engine project directory.');
    if (c.engine === 'indextts') {
      if (!c.modelDir) fail('MODEL_PATH', 'Select the existing IndexTTS model directory.');
      if (voice === 'default') fail('VOICE', 'Select an existing IndexTTS reference audio file as Voice.');
      args = [fileURLToPath(new URL('../../adapters/index-tts-worker.py', import.meta.url)), '--project-path', c.projectPath, '--model-dir', c.modelDir,
        '--lang', String(c.textLang || 'ZH').toUpperCase(), '--duration-factor', String(durationFactor)];
      if (c.presetsRoot) args.push('--presets-root', c.presetsRoot);
      if (c.device) args.push('--device', c.device);
      if (c.voice) args.push('--voice', c.voice);
    } else {
      if (!c.apiScript || !c.referenceAudio) fail('GPT_CONFIG', 'Select api_v2.py and a reference audio file.');
      if (voice === 'default') voice = c.referenceAudio.trim();
      args = [fileURLToPath(new URL('../../adapters/gpt-sovits-worker.py', import.meta.url)), '--api-script', c.apiScript, '--project-path', c.projectPath, '--ref-audio', c.referenceAudio, '--prompt-text', c.promptText, '--prompt-lang', c.promptLang, '--text-lang', c.textLang, '--speed-factor', String(speedFactor), '--port', String(c.port)];
      if (c.ttsConfig) args.push('--tts-config', c.ttsConfig);
    }
  }
  if (typeof command !== 'string' || !command || command.length > 1024) fail('COMMAND', 'Configure the Python executable path.');
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.length > 2048) || args.length > 64)
    fail('ARGS', 'Worker arguments must be an array of strings.');
  if (typeof c.cwd !== 'string' || c.cwd.length > 2048) fail('CWD', 'Worker working directory is invalid.');
  for (const [key, min, max] of [['startupTimeoutMs', 1000, 600000], ['timeoutMs', 100, 600000]])
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) fail('TIMEOUT_CONFIG', `${key} must be ${min}–${max} ms.`);
  const startupTimeoutMs = c.launchPreset === 'webui' && c.engine === 'gpt-sovits' && c.webuiMode === 'auto'
    ? Math.max(c.startupTimeoutMs, 300000) : c.startupTimeoutMs;
  return { mode: 'process', launchPreset: c.launchPreset, engine: c.engine, pythonPath: c.pythonPath.trim(), projectPath: c.projectPath.trim(), modelDir: c.modelDir.trim(), presetsRoot: c.presetsRoot.trim(), device: c.device.trim(), apiScript: c.apiScript.trim(), ttsConfig: c.ttsConfig.trim(), referenceAudio: c.referenceAudio.trim(), promptText: c.promptText, promptLang: c.promptLang.trim(), textLang: c.textLang.trim(), durationFactor, speedFactor, port: c.port, command, args: args.slice(), cwd: c.cwd.trim() || c.projectPath.trim(), voice, startupTimeoutMs, timeoutMs: c.timeoutMs, autoStart: c.autoStart !== false, debug: c.debug === true,
    webuiMode: c.webuiMode, webuiEndpoint: c.webuiEndpoint.trim(), webuiVariant: c.webuiVariant, gptVersion: c.gptVersion, gptModel: c.gptModel, sovitsModel: c.sovitsModel };
}

export function normalizeConfig(value = {}) {
  if (value?.mode === 'process') return processConfig(value);
  const c = { ...DEFAULTS, ...value };
  if (!['indextts', 'gpt-sovits'].includes(c.engine)) fail('ENGINE', 'Unsupported engine.');
  if (!['auto', 'runtime-v1', 'openai-speech'].includes(c.protocol)) fail('PROTOCOL', 'Unsupported HTTP protocol.');
  let url;
  try { url = new URL(c.endpoint); } catch { fail('ENDPOINT', 'Enter a Runtime endpoint, including http:// and its port.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    fail('ENDPOINT', 'Endpoint must be HTTP(S), without credentials, query or fragment.');
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const ip = url.hostname.split('.').map(Number);
  const privateIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && ip.every(n => n >= 0 && n <= 255) &&
    (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168));
  if (!loopback && !(c.allowLan === true && privateIp))
    fail('LOCAL_ONLY', 'Only 127.0.0.1 / localhost are allowed by default. Private LAN IPv4 requires explicit consent; public hosts are blocked.');
  if (typeof c.voice !== 'string' || !c.voice.trim() || c.voice.length > 256) fail('VOICE', 'Voice must be a non-empty ID (up to 256 characters).');
  if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 300000) fail('TIMEOUT_CONFIG', 'Timeout must be 100–300000 ms.');
  return { engine: c.engine, endpoint: url.toString().replace(/\/+$/, ''), voice: c.voice.trim(), protocol: c.protocol,
    timeoutMs: c.timeoutMs, allowLan: c.allowLan === true, debug: c.debug === true };
}

function processError(code, message) { return new RuntimeError(code, message); }

export class ProcessTTSProvider {
  constructor(config, { logger = record => console.info('[local-tts]', JSON.stringify(record)) } = {}) {
    this.config = processConfig(config); this.logger = logger; this.child = null; this.buffer = ''; this.pending = new Map(); this.startPromise = null; this.closed = false;
  }
  async start() {
    if (this.closed) throw processError('CLOSED', 'Local TTS worker is closed.');
    if (this.startPromise) return this.startPromise;
    if (this.shutdownPromise) await this.shutdownPromise;
    if (this.closed) throw processError('CLOSED', 'Local TTS worker is closed.');
    if (this.startPromise) return this.startPromise;
    if (this.child && this.ready && !this.child.killed) return;
    const starting = (async () => {
      let child;
      try { child = spawn(this.config.command, this.config.args, { cwd: this.config.cwd || undefined, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', DSH_TTS_DEBUG: this.config.debug ? '1' : '0', DSH_TTS_STARTUP_SECONDS: String(this.config.startupTimeoutMs / 1000), DSH_TTS_REQUEST_SECONDS: String(this.config.timeoutMs / 1000) } }); }
      catch { throw processError('SPAWN', 'Cannot start the configured Python worker.'); }
      this.child = child; this.ready = false; this.buffer = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => this.onData(chunk));
      child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { const line = String(chunk).trim().split(/\r?\n/).pop(); if (this.config.debug && line) this.logger({ status: 'worker-stderr', error: line.slice(0, 500) }); });
      child.stdin.on('error', () => this.failPending(processError('WRITE', 'Local worker input closed.')));
      child.once('error', () => this.failPending(processError('SPAWN', 'Local TTS worker failed to start.')));
      child.once('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null; this.ready = false;
        this.failPending(processError('WORKER_EXIT', `Local TTS worker exited (${code ?? signal ?? 'unknown'}).`));
      });
      const health = await this.request('health', {}, this.config.startupTimeoutMs);
      if (health.ready !== true) throw processError('NOT_READY', 'Local service has not finished loading.');
      this.ready = true;
    })();
    this.startPromise = starting;
    try { await starting; }
    catch (e) { await this.shutdown(); throw e; }
    finally { if (this.startPromise === starting) this.startPromise = null; }
  }
  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) {
      this.failPending(processError('WORKER_OUTPUT', 'Worker output exceeded the safety limit.'));
      try { this.child?.kill(); } catch {}
      this.buffer = '';
      return;
    }
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim(); this.buffer = this.buffer.slice(idx + 1); if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const item = this.pending.get(msg.id); if (!item) continue; this.pending.delete(msg.id); clearTimeout(item.timer);
      if (msg.ok === false) item.reject(processError(msg.code || 'SYNTHESIS', String(msg.error || 'Worker synthesis failed.').slice(0, 500)));
      else item.resolve(msg);
    }
  }
  failPending(error) {
    for (const [id, item] of this.pending) { clearTimeout(item.timer); item.reject(error); this.pending.delete(id); }
  }
  request(action, payload, timeoutMs = this.config.timeoutMs) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) return Promise.reject(processError('OFFLINE', 'Local TTS worker is not running.'));
    const id = randomUuidProcess();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(processError('TIMEOUT', 'Local TTS worker request timed out.'));
        this.shutdown();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ id, action, ...payload }) + '\n'); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(processError('WRITE', `Cannot send request to worker: ${e.message}`)); }
    });
  }
  async healthCheck() { await this.start(); const msg = await this.request('health', {}, this.config.startupTimeoutMs); return { ready: msg.ready !== false && msg.ok !== false, status: msg.status || 'ready' }; }
  async listVoices() { await this.start(); const msg = await this.request('voices', {}, this.config.timeoutMs); const list = Array.isArray(msg.voices) ? msg.voices : []; return { supported: true, voices: list.map(v => typeof v === 'string' ? { id: v, name: v } : { id: v.id, name: v.name || v.id }).filter(v => typeof v.id === 'string').slice(0, 1000) }; }
  async synthesize({ text, voice = this.config.voice, engine = this.config.engine, options = {} }) {
    if (engine !== this.config.engine) throw processError('ENGINE', 'Create a new adapter when switching engines.');
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 70 || sentences(text).length !== 1) throw processError('SENTENCE', 'Each synthesis request must contain exactly one sentence or segment of at most 70 characters.');
    if (Object.keys(options).length) throw processError('OPTIONS', 'Model inference options are owned by the local worker.');
    const start = Date.now(), requestId = randomUuidProcess();
    try { if (this.config.autoStart) await this.start(); else if (!this.child) throw processError('OFFLINE', 'Worker is not running and automatic start is disabled.'); const msg = await this.request('synthesize', { text, voice, engine }, this.config.timeoutMs); const data = msg.audioBase64 || msg.audio_base64; if (typeof data !== 'string') throw processError('BAD_AUDIO', 'Worker response is missing audioBase64.'); const mime = typeof msg.mime === 'string' ? msg.mime : 'audio/wav'; const out = { data: Buffer.from(data, 'base64'), mime, ...(typeof msg.retryAttempted === 'boolean' ? { retryAttempted: msg.retryAttempted, retryApplied: msg.retryApplied === true } : {}) }; this.logger({ requestId, chars: Array.from(text).length, elapsedMs: Date.now() - start, status: 'ok', ...(msg.retryAttempted ? { retryAttempted: true, retryApplied: msg.retryApplied === true } : {}), ...(this.config.debug ? { text } : {}) }); return out; }
    catch (e) { this.logger({ requestId, chars: Array.from(text).length, elapsedMs: Date.now() - start, status: 'error', error: e.code || 'INTERNAL', ...(this.config.debug ? { text } : {}) }); throw e; }
  }
  cancel() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(processError('CANCELLED', 'Reading cancelled.')); } this.pending.clear(); }
  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.ready = false; this.cancel();
    const child = this.child;
    if (!child || child.exitCode !== null || !child.pid) { this.child = null; return Promise.resolve(); }
    // EOF lets the Python connector reap its own engine child before exiting.
    // Do not immediately kill that connector and orphan api_v2 on Windows.
    this.shutdownPromise = new Promise(resolve => {
      const timer = setTimeout(() => { try { child.kill(); } catch {} }, 4000); timer.unref?.();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      try { child.stdin.end(); } catch { try { child.kill(); } catch {} }
    }).finally(() => { this.shutdownPromise = null; if (this.child === child) this.child = null; });
    return this.shutdownPromise;
  }
  dispose() { this.closed = true; return this.shutdown(); }
  status() { return { running: !!(this.child && !this.child.killed), engine: this.config.engine, voice: this.config.voice }; }
}

// Pin localhost to loopback. Never follow redirects or forward browser headers/cookies.
function request(config, route, payload, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let failure;
    const url = new URL(config.endpoint + route);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: body === undefined ? 'GET' : 'POST', signal,
      lookup: (_host, options, cb) => options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4),
      headers: body === undefined ? { Accept: 'application/json' } : {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json, audio/*' },
    }, res => {
      let size = 0; const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new RuntimeError('TOO_LARGE', 'Runtime response exceeds the size limit.'));
        else chunks.push(chunk);
      });
      res.on('error', () => reject(failure || new RuntimeError(signal?.aborted ? 'CANCELLED' : 'OFFLINE', signal?.aborted ? 'Reading cancelled.' : 'Runtime closed the response before completion.')));
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || '').split(';')[0], data: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => {
      failure = new RuntimeError('TIMEOUT', 'Runtime request timed out. Check its status or increase the request timeout.');
      req.destroy(failure);
    }, config.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', error => {
      if (error instanceof RuntimeError) reject(error);
      else if (signal?.aborted) reject(new RuntimeError('CANCELLED', 'Reading cancelled.'));
      else reject(new RuntimeError('OFFLINE', `Cannot connect to Runtime (${['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.code) ? error.code : 'NETWORK_ERROR'}). Check endpoint and service availability.`));
    });
    req.end(body);
  });
}
function json(result) {
  try { return JSON.parse(result.data.toString('utf8')); } catch { fail('BAD_JSON', 'Runtime returned invalid JSON. Check the selected HTTP protocol.'); }
}
function check(result) {
  if (result.status < 200 || result.status >= 300) {
    const hint = ({401: 'Runtime requires authorization; this connector does not read Harness credentials.',403: 'Runtime denied access.',404: 'Route missing. Check endpoint and protocol.',429: 'Runtime is busy.',503: 'Runtime is not ready.'})[result.status] || 'Check Runtime service logs.';
    fail('HTTP_' + result.status, `Runtime HTTP ${result.status}. ${hint}`);
  }
}
export function pcmToWav(pcm, sampleRate, channels = 1) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || ![1, 2].includes(channels) || !pcm.length || pcm.length % (2 * channels))
    fail('BAD_AUDIO', 'Expected non-empty s16le PCM with valid sample rate and channels.');
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
}
function audio(result) {
  if (result.type === 'application/json') {
    const d = json(result);
    if (d.ok === false) fail('SYNTHESIS', 'Runtime reported synthesis failure. Check its logs.');
    const b64 = d.pcm_base64;
    if (d.format !== 's16le' || typeof b64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64))
      fail('BAD_AUDIO', 'Runtime JSON must contain s16le pcm_base64, sample_rate and channels.');
    return { data: pcmToWav(Buffer.from(b64, 'base64'), d.sample_rate, d.channels ?? 1), mime: 'audio/wav' };
  }
  if (!['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'].includes(result.type) || result.data.length < 12)
    fail('BAD_AUDIO', 'Runtime must return WAV/MP3/Ogg/FLAC audio or the documented PCM JSON envelope.');
  if (result.type.includes('wav') && (result.data.toString('ascii', 0, 4) !== 'RIFF' || result.data.toString('ascii', 8, 12) !== 'WAVE'))
    fail('BAD_AUDIO', 'Runtime returned an invalid WAV header.');
  return { data: result.data, mime: result.type };
}

export class LocalRuntimeProvider {
  constructor(config, { logger = record => console.info('[local-tts]', JSON.stringify(record)) } = {}) {
    this.config = normalizeConfig(config); this.logger = logger; this.controllers = new Set();
  }
  get protocol() { return this.config.protocol === 'auto' ? (this.config.engine === 'indextts' ? 'runtime-v1' : 'openai-speech') : this.config.protocol; }
  async call(route, payload, maxBytes = 1024 * 1024) {
    const controller = new AbortController(); this.controllers.add(controller);
    try { return await request(this.config, route, payload, controller.signal, maxBytes); }
    finally { this.controllers.delete(controller); }
  }
  async healthCheck() {
    const r = await this.call('/health'); check(r); const d = json(r);
    if (d.engine && d.engine !== this.config.engine) fail('ENGINE_MISMATCH', 'Runtime reports a different engine. Check Engine and Endpoint.');
    const ready = d.ok !== false && d.ready !== false && (d.ready === true || ['ready', 'ok', 'healthy'].includes(d.status));
    return { ready, status: ready ? 'ready' : (['loading', 'unloaded', 'busy', 'error'].includes(d.status) ? d.status : 'not-ready') };
  }
  async listVoices() {
    const r = await this.call(this.protocol === 'openai-speech' ? '/v1/audio/voices' : '/voices');
    if ([404, 405, 501].includes(r.status)) return { supported: false, voices: [] };
    check(r); const d = json(r); const list = Array.isArray(d) ? d : d.voices;
    if (!Array.isArray(list)) fail('BAD_VOICES', 'Runtime voices response must be an array or {voices: []}.');
    const voices = list.slice(0, 1000).map(v => typeof v === 'string' ? { id: v, name: v } : { id: v?.id, name: v?.name || v?.id })
      .filter(v => typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 256 && typeof v.name === 'string')
      .map(v => ({ id: v.id, name: v.name.slice(0, 256) }));
    return { supported: true, voices };
  }
  async synthesize({ text, voice = this.config.voice, engine = this.config.engine, options = {} }) {
    if (engine !== this.config.engine) fail('ENGINE', 'Create a new adapter when switching engines.');
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 70 || sentences(text).length !== 1)
      fail('SENTENCE', 'Each synthesis request must contain exactly one sentence or segment of at most 70 characters.');
    if (Object.keys(options).length) fail('OPTIONS', 'Model inference options are owned by Runtime, not this plugin.');
    normalizeConfig({ ...this.config, voice });
    const requestId = randomUUID(), start = Date.now(), chars = Array.from(text).length;
    const log = (status, error) => this.logger({ requestId, chars, elapsedMs: Date.now() - start, status, ...(error ? { error } : {}), ...(this.config.debug ? { text } : {}) });
    try {
      const route = this.protocol === 'openai-speech' ? '/v1/audio/speech' : '/synthesize';
      const payload = this.protocol === 'openai-speech' ? { input: text, voice, model: engine, response_format: 'wav' } : { text, voice, engine };
      const r = await this.call(route, payload, 16 * 1024 * 1024); check(r);
      const result = audio(r); log('ok'); return result;
    } catch (error) { log('error', error.code || 'INTERNAL'); throw error; }
  }
  cancel() { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
export class IndexTTSAdapter extends LocalRuntimeProvider { constructor(config, deps) { super({ ...config, engine: 'indextts' }, deps); } }
export class GPTSoVITSAdapter extends LocalRuntimeProvider { constructor(config, deps) { super({ ...config, engine: 'gpt-sovits' }, deps); } }
export function createProvider(config, deps) {
  const c = normalizeConfig(config);
  if (c.mode === 'process') return new ProcessTTSProvider(c, deps);
  return c.engine === 'indextts' ? new IndexTTSAdapter(c, deps) : new GPTSoVITSAdapter(c, deps);
}
