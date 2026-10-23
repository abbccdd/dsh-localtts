import { open } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from './errors.mjs';

const fail = (code, message) => { throw new RuntimeError(code, message); };
export const HTTP_DEFAULTS = Object.freeze({
  model: '', speechPath: '/v1/audio/speech', healthPath: '', healthMode: 'json', voicesPath: '/v1/audio/voices',
  requestEncoding: 'json', requestBody: '{"text":"{{text}}"}', extraBody: '{}', audioFiles: '{}',
  responseAudio: 'auto', sampleRate: 24000, channels: 1, audioBase64Path: '', apiKeyEnv: '',
});

function objectJSON(value, name) {
  if (typeof value !== 'string' || value.length > 32768) fail('HTTP_CONFIG', `${name} must be a JSON object (up to 32 KiB).`);
  let result;
  try { result = JSON.parse(value); } catch { fail('HTTP_CONFIG', `${name} contains invalid JSON.`); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('HTTP_CONFIG', `${name} must be a JSON object.`);
  return result;
}

// Substitute complete JSON values, never splice user text into serialized JSON.
export function expandTemplate(value, variables) {
  if (typeof value === 'string') {
    const match = value.match(/^\{\{(text|voice|model)\}\}$/);
    return match ? variables[match[1]] : value;
  }
  if (Array.isArray(value)) return value.map(v => expandTemplate(v, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandTemplate(v, variables)]));
  return value;
}

export function normalizeHttpProfile(value, protocol) {
  const c = { ...HTTP_DEFAULTS, ...value };
  for (const key of ['model', 'speechPath', 'healthPath', 'voicesPath', 'audioBase64Path', 'apiKeyEnv']) {
    if (typeof c[key] !== 'string' || c[key].length > 2048 || /[\x00-\x1f\x7f]/.test(c[key])) fail('HTTP_CONFIG', `${key} is invalid.`);
    c[key] = c[key].trim();
  }
  for (const key of ['speechPath', 'healthPath', 'voicesPath']) {
    const route = c[key];
    if ((!route && key === 'speechPath') || (route && (!route.startsWith('/') || route.startsWith('//') || /[\\\s#]/.test(route))))
      fail('HTTP_CONFIG', `${key} must be a local route beginning with / (optional query, no host or fragment).`);
  }
  if (!['json', 'form', 'multipart'].includes(c.requestEncoding) || !['json', 'http'].includes(c.healthMode)) fail('HTTP_CONFIG', 'Unsupported request encoding or health check mode.');
  if (!['auto', 'pcm-s16le'].includes(c.responseAudio)) fail('HTTP_CONFIG', 'Unsupported audio response format.');
  if (!Number.isInteger(c.sampleRate) || c.sampleRate < 8000 || c.sampleRate > 192000 || ![1, 2].includes(c.channels))
    fail('HTTP_CONFIG', 'PCM requires an 8000–192000 Hz sample rate and 1 or 2 channels.');
  if (c.audioBase64Path && !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(c.audioBase64Path)) fail('HTTP_CONFIG', 'Base64 field must be a dot-separated JSON field path.');
  if (c.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(c.apiKeyEnv)) fail('HTTP_CONFIG', 'API key environment variable name is invalid.');
  const body = objectJSON(c.requestBody, 'Request body'), extra = objectJSON(c.extraBody, 'Extra fields'), files = objectJSON(c.audioFiles, 'Audio files');
  if (protocol === 'openai-speech' && !c.model) fail('HTTP_CONFIG', 'Enter the model name expected by your speech service.');
  if (protocol === 'custom-http') {
    let hasText = false;
    function visit(v, depth = 0) {
      if (depth > 20) fail('HTTP_CONFIG', 'Request body nesting exceeds 20 levels.');
      if (typeof v === 'string') {
        if (v === '{{text}}') hasText = true;
        if (/\{\{|\}\}/.test(v) && !/^\{\{(text|voice|model)\}\}$/.test(v)) fail('HTTP_CONFIG', 'Placeholders must be complete values: {{text}}, {{voice}} or {{model}}.');
      } else if (v && typeof v === 'object') Object.values(v).forEach(x => visit(x, depth + 1));
    }
    visit(body);
    if (!hasText) fail('HTTP_CONFIG', 'Request body must contain a {{text}} value.');
    if (c.requestEncoding !== 'json' && Object.values(body).some(v => v !== null && typeof v === 'object')) fail('HTTP_CONFIG', 'Form fields must be scalar values; use JSON encoding for nested objects.');
  }
  const entries = Object.entries(files);
  if (entries.length > 3) fail('HTTP_CONFIG', 'At most three reference audio uploads are supported.');
  if (entries.length && (protocol !== 'custom-http' || c.requestEncoding !== 'multipart')) fail('HTTP_CONFIG', 'Audio uploads require custom HTTP with multipart encoding.');
  for (const [key, file] of entries) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || typeof file !== 'string' || !path.isAbsolute(file) || !/\.(wav|mp3|flac|ogg)$/i.test(file) || file.includes('\0') || file.length > 4096 || Object.hasOwn(body, key))
      fail('HTTP_CONFIG', 'Audio upload fields need distinct names and absolute WAV/MP3/FLAC/Ogg file paths.');
  }
  return Object.fromEntries(Object.keys(HTTP_DEFAULTS).map(key => [key,
    key === 'requestBody' ? JSON.stringify(body) : key === 'extraBody' ? JSON.stringify(extra) : key === 'audioFiles' ? JSON.stringify(files) : c[key]]));
}

export function speechRoute(config, route) {
  // Accept both http://localhost:port and http://localhost:port/v1 bases.
  return config.protocol === 'openai-speech' && new URL(config.endpoint).pathname.endsWith('/v1') && route.startsWith('/v1/') ? route.slice(3) : route;
}

export function detectAudioMime(data) {
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (data.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (data.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return '';
}

export async function encodeHttpPayload(config, variables, signal) {
  const payload = config.protocol === 'openai-speech'
    ? { ...JSON.parse(config.extraBody), input: variables.text, voice: variables.voice, model: config.model, response_format: 'wav', stream: false }
    : expandTemplate(JSON.parse(config.requestBody), variables);
  if (config.protocol === 'openai-speech' || config.requestEncoding === 'json') return { body: Buffer.from(JSON.stringify(payload)), type: 'application/json' };
  if (config.requestEncoding === 'form') return { body: Buffer.from(new URLSearchParams(Object.entries(payload).map(([key, v]) => [key, String(v ?? '')])).toString()), type: 'application/x-www-form-urlencoded' };
  const form = new FormData();
  for (const [key, v] of Object.entries(payload)) form.set(key, String(v ?? ''));
  let index = 0;
  for (const [key, file] of Object.entries(JSON.parse(config.audioFiles))) {
    // Read at most 16 MiB + 1 even if another process grows/replaces the file.
    let handle;
    try { handle = await open(file, 'r'); } catch { fail('REFERENCE_AUDIO', 'Cannot open the configured reference audio file.'); }
    let data;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) fail('REFERENCE_AUDIO', 'Reference audio must be a regular file of at most 16 MiB.');
      const buffer = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < buffer.length) {
        signal?.throwIfAborted();
        const read = await handle.read(buffer, size, buffer.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size !== stat.size) fail('REFERENCE_AUDIO', 'Reference audio changed during upload preparation.');
      data = buffer.subarray(0, size);
    } finally { await handle.close(); }
    const mime = detectAudioMime(data);
    if (!mime) fail('REFERENCE_AUDIO', 'Reference file does not contain WAV/MP3/FLAC/Ogg audio.');
    form.set(key, new Blob([data], { type: mime }), `reference-${++index}${path.extname(file).toLowerCase()}`);
  }
  const response = new Response(form);
  return { body: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') };
}
