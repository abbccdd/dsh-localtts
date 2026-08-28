import { opendir, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from './provider.mjs';

// Read-only discovery. Never run a launcher, import Python, read audio/weights,
// scan a whole drive, or follow a descendant link outside the selected folder.
const AUDIO = /\.(wav|mp3|flac|ogg|m4a)$/i;
const WRAPPERS = ['app', 'index-tts', 'IndexTTS', 'IndexTTS2.5', 'GPT-SoVITS'];
const PYTHON = ['.venv/Scripts/python.exe', 'venv/Scripts/python.exe', 'env/Scripts/python.exe',
  'runtime/python.exe', 'python/python.exe', '.venv/bin/python', 'venv/bin/python', 'env/bin/python'];
const AUDIO_DIRS = ['examples', 'voices', 'ref_audios', 'refer_audios', 'reference_audio', 'reference_audios', 'outputs/presets'];
const GPT_VERSIONS = ['v1', 'v2', 'v3', 'v4', 'v2Pro', 'v2ProPlus'];
const inside = (base, file) => { const rel = path.relative(base, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

export async function discoverEngine({ engine, projectPath } = {}) {
  if (!['indextts', 'gpt-sovits'].includes(engine)) throw new RuntimeError('ENGINE', 'Select IndexTTS 2.5 or GPT-SoVITS.');
  if (typeof projectPath !== 'string' || projectPath.length > 4096 || /[\0\r\n]/.test(projectPath))
    throw new RuntimeError('PROJECT_PATH', 'Enter the existing engine folder on the Harness Host.');
  const input = projectPath.trim().replace(/^"(.*)"$/, '$1');
  if (!path.isAbsolute(input) || /^[\\/]{2}/.test(input) || path.resolve(input) === path.parse(path.resolve(input)).root)
    throw new RuntimeError('PROJECT_PATH', 'Use an absolute local project folder, not a drive root or network share.');
  let base;
  try { base = await realpath(input); if (!(await stat(base)).isDirectory()) throw new Error(); }
  catch { throw new RuntimeError('PROJECT_PATH', 'Project folder is missing or inaccessible on the Harness Host.'); }
  if (/^[\\/]{2}/.test(base) || base === path.parse(base).root)
    throw new RuntimeError('PROJECT_PATH', 'Select a local project folder, not a drive root or network share.');
  const warnings = new Set();
  async function existing(file, kind = 'file') {
    if (!inside(base, file)) return null;
    try {
      const resolved = await realpath(file);
      if (!inside(base, resolved) || /^[\\/]{2}/.test(resolved)) return null;
      const info = await stat(resolved);
      return (kind === 'directory' ? info.isDirectory() : info.isFile()) ? file : null;
    } catch (e) { if (e.code === 'EACCES' || e.code === 'EPERM') warnings.add('INACCESSIBLE_FILES'); return null; }
  }
  async function projectAt(root) {
    return engine === 'indextts'
      ? !!await existing(path.join(root, 'indextts/infer_v2_5.py'))
      : !!await existing(path.join(root, 'api_v2.py')) && !!await existing(path.join(root, 'GPT_SoVITS'), 'directory');
  }
  let projects = await projectAt(base) ? [base] : [];
  if (!projects.length) for (const wrapper of WRAPPERS) {
    const root = path.join(base, wrapper);
    if (await projectAt(root)) projects.push(root);
  }
  if (!projects.length) throw new RuntimeError('ENGINE_NOT_FOUND', 'Engine entry not found. Select the folder containing indextts/infer_v2_5.py or api_v2.py and GPT_SoVITS.');
  if (projects.length > 1) throw new RuntimeError('AMBIGUOUS_PROJECT', 'Multiple engine projects found. Select the intended project subfolder.');
  const root = projects[0], config = { projectPath: root }, candidates = { pythonPath: [], modelDir: [], voices: [] };
  async function header(relative) {
    const file = await existing(path.join(root, relative));
    if (!file) return '';
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally { await handle.close(); }
  }
  // Read literal official port settings only; never execute config.py/BAT.
  const portSource = await header(engine === 'indextts' ? 'webui.py' : 'config.py');
  const port = engine === 'indextts'
    ? portSource.match(/add_argument\(["']--port["'][^\n]*\bdefault\s*=\s*(\d+)/)?.[1]
    : portSource.match(/^webui_port_infer_tts\s*=\s*(\d+)\s*(?:#.*)?$/m)?.[1];
  if (port && Number(port) > 0 && Number(port) <= 65535) config.webuiEndpoint = `http://127.0.0.1:${port}`;
  if (engine === 'gpt-sovits') {
    try {
      const weights = JSON.parse(await header('weight.json') || '{}');
      candidates.gptVersion = Object.keys(weights.GPT || {}).filter(v => Object.hasOwn(weights.SoVITS || {}, v));
      if (candidates.gptVersion.length === 1) config.gptVersion = candidates.gptVersion[0];
      else if (!candidates.gptVersion.length && (Object.keys(weights.GPT || {}).length || Object.keys(weights.SoVITS || {}).length)) warnings.add('SAVED_MODELS_INCOMPLETE');
    } catch { warnings.add('SAVED_MODELS_UNREADABLE'); }
  }
  for (const parent of [...new Set([root, base])]) for (const relative of PYTHON) {
    const found = await existing(path.join(parent, relative));
    if (found) candidates.pythonPath.push(found);
  }
  if (candidates.pythonPath.length === 1) config.pythonPath = candidates.pythonPath[0];
  else warnings.add(candidates.pythonPath.length ? 'MULTIPLE_PYTHONS' : 'PYTHON_NOT_FOUND');
  if (engine === 'indextts') {
    for (const relative of ['checkpoints', 'checkpoints_25', 'models/IndexTTS-2.5']) {
      const dir = path.join(root, relative), file = await existing(path.join(dir, 'config.yaml'));
      if (!file) continue;
      // Only inspect a bounded config header; no YAML execution or model reads.
      const handle = await open(file, 'r');
      let version;
      try {
        const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        version = buffer.toString('utf8', 0, bytesRead).match(/^version\s*:\s*['"]?([\d.]+)/m)?.[1];
      } finally { await handle.close(); }
      if (version && version !== '2.5') { warnings.add('OTHER_INDEX_VERSION'); continue; }
      if (!version) warnings.add('MODEL_VERSION_UNCONFIRMED');
      candidates.modelDir.push(dir);
    }
    if (candidates.modelDir.length === 1) config.modelDir = candidates.modelDir[0];
    else warnings.add(candidates.modelDir.length ? 'MULTIPLE_MODELS' : 'MODEL_NOT_FOUND');
  } else {
    config.apiScript = path.join(root, 'api_v2.py');
    const yaml = await existing(path.join(root, 'GPT_SoVITS/configs/tts_infer.yaml'));
    if (yaml) config.ttsConfig = yaml;
    else warnings.add('TTS_CONFIG_NOT_FOUND');
  }
  const seen = new Set(); let entries = 0;
  if (engine === 'gpt-sovits') {
    candidates.characters = [];
    const dir = path.join(root, 'runtime_voices');
    // Optional local-runtime voice.json v1, not an official WebUI preset format.
    // Read only direct character metadata; never deserialize conditioning.pt.
    async function presetFile(parent, value, extension) {
      if (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/.test(value) || /^[\\/]{2}/.test(value) || value.includes('://')) return null;
      const file = path.resolve(parent, value);
      if (!inside(parent, file) || !extension.test(file)) return null;
      const found = await existing(file);
      return found && inside(parent, await realpath(found)) ? found : null;
    }
    if (await existing(dir, 'directory')) {
      const stream = await opendir(dir);
      for await (const entry of stream) {
        if (++entries > 1500 || candidates.characters.length >= 100) { warnings.add('AUDIO_LIST_TRUNCATED'); break; }
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const voiceDir = path.join(dir, entry.name), file = await existing(path.join(voiceDir, 'voice.json'));
        if (!file) continue;
        try {
          const voice = JSON.parse((await header(path.relative(root, file))).replace(/^\uFEFF/, ''));
          if (voice?.format_version !== 1 || !GPT_VERSIONS.includes(voice.model_version)
            || typeof voice.prompt_text !== 'string' || !voice.prompt_text.trim() || voice.prompt_text.length > 4096
            || !['zh', 'en', 'ja', 'ko', 'yue', 'auto', 'all_zh', 'all_ja', 'all_ko', 'all_yue'].includes(voice.prompt_lang)) throw new Error('Unsupported character metadata');
          const referenceAudio = await presetFile(voiceDir, voice.reference_audio, AUDIO);
          const gptModel = await presetFile(root, voice.gpt_checkpoint, /\.ckpt$/i);
          const sovitsModel = await presetFile(root, voice.sovits_checkpoint, /\.pth$/i);
          if (!referenceAudio || !gptModel || !sovitsModel) throw new Error('Missing or unsafe character files');
          candidates.characters.push({ id: file, name: typeof voice.name === 'string' && voice.name.trim() && voice.name.length <= 200 ? voice.name : entry.name,
            config: { referenceAudio, gptModel, sovitsModel, gptVersion: voice.model_version, promptText: voice.prompt_text, promptLang: voice.prompt_lang } });
        } catch { warnings.add('CHARACTER_PRESET_INVALID'); }
      }
    }
    candidates.characters.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function audioIn(dir, depth) {
    if (!await existing(dir, 'directory') || entries >= 1500 || candidates.voices.length >= 100) return;
    const resolved = await realpath(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    try {
      const stream = await opendir(dir);
      for await (const entry of stream) {
        if (++entries > 1500 || candidates.voices.length >= 100) { warnings.add('AUDIO_LIST_TRUNCATED'); break; }
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile() && AUDIO.test(entry.name) && await existing(full))
          candidates.voices.push({ id: full, name: path.relative(root, full) });
        else if (entry.isDirectory() && depth > 0) await audioIn(full, depth - 1);
      }
    } catch (e) { if (e.code === 'EACCES' || e.code === 'EPERM') warnings.add('INACCESSIBLE_FILES'); else throw e; }
  }
  await audioIn(root, 0);
  for (const relative of AUDIO_DIRS) await audioIn(path.join(root, relative), 2);
  if (engine === 'gpt-sovits') await audioIn(path.join(root, 'runtime_voices'), 1);
  candidates.voices.sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.characters?.length) warnings.add('CHOOSE_CHARACTER');
  else if (candidates.voices.length === 1) {
    config.voice = candidates.voices[0].id;
    if (engine === 'gpt-sovits') config.referenceAudio = config.voice;
  } else warnings.add(candidates.voices.length ? 'CHOOSE_REFERENCE' : 'REFERENCE_NOT_FOUND');
  return { config, candidates, warnings: [...warnings], layoutOnly: true };
}
