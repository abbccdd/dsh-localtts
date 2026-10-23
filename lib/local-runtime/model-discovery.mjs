import { readdir, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError } from './errors.mjs';

const fail = message => { throw new RuntimeError('MODEL_FOLDER', message); };
async function exists(file) { try { return (await stat(file)).isFile(); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return false; throw e; } }
async function json(file) {
  if (!await exists(file)) return {};
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > 262144) fail('模型配置过大，无法识别。');
    try {
      const value = JSON.parse(await handle.readFile('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('模型 JSON 配置必须为对象：' + path.basename(file));
      return value;
    }
    catch (e) { if (e instanceof SyntaxError) fail('模型 JSON 配置格式有误：' + path.basename(file)); throw e; }
  } finally { await handle.close(); }
}
async function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value) || value.includes('\0')) fail('请填写本机文件夹的完整路径。');
  let folder;
  try { folder = await realpath(value); }
  catch (e) { if (['ENOENT', 'EACCES', 'EPERM'].includes(e.code)) fail('文件夹不存在或无法访问，请检查完整路径。'); throw e; }
  if (!(await stat(folder)).isDirectory()) fail('请选择文件夹。');
  return folder;
}
const within = (base, target) => { const rel = path.relative(base, target); return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };

// Read directory names and small JSON only. Never import project code or unpickle weights.
export async function browseModelFolders({ folder = '' } = {}) {
  if (!folder) {
    const roots = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(d => d + ':\\') : ['/'];
    const available = await Promise.all(roots.map(async value => { try { await stat(value); return { name: value, path: value }; } catch (e) { if (['ENOENT', 'EACCES', 'EPERM'].includes(e.code)) return null; throw e; } }));
    return { folder: '', parent: '', folders: available.filter(Boolean) };
  }
  const base = await directory(folder), entries = await readdir(base, { withFileTypes: true });
  return { folder: base, parent: path.dirname(base) === base ? '' : path.dirname(base),
    folders: entries.filter(e => e.isDirectory() && !e.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200).map(e => ({ name: e.name, path: path.join(base, e.name) })), truncated: entries.filter(e => e.isDirectory()).length > 200 };
}

export async function discoverModelFolder({ modelDir } = {}) {
  const base = await directory(modelDir);
  if (base === path.parse(base).root) fail('请选择模型所在文件夹，不能选择整个磁盘。');
  const dirs = [base];
  for (const entry of (await readdir(base, { withFileTypes: true })).slice(0, 200)) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) dirs.push(path.join(base, entry.name));
  }
  const models = [];
  for (const folder of dirs) {
    const c = await json(path.join(folder, 'config.json'));
    const has = name => exists(path.join(folder, name));
    let type = '', name = '', voices = [], needsReference = false;
    if (await has('kokoro-v1_0.pth') && await has('config.json')) {
      type = 'kokoro'; name = 'Kokoro 82M';
      if (await stat(path.join(folder, 'voices')).then(s => s.isDirectory(), e => { if (e.code === 'ENOENT') return false; throw e; }))
        voices = (await readdir(path.join(folder, 'voices'), { withFileTypes: true })).filter(e => e.isFile() && /^[abefhijpz][fm]_[\w-]+\.pt$/.test(e.name)).map(e => ({ id: e.name.slice(0, -3), name: e.name.slice(0, -3) }));
    } else if (c.model_type === 'qwen3_tts' && c.tts_model_type === 'custom_voice' && await has('model.safetensors')) {
      type = 'qwen3'; name = 'Qwen3-TTS CustomVoice';
      voices = Object.keys(c.talker_config?.spk_id || {}).map(id => ({ id, name: id }));
    } else if (c.architecture === 'voxcpm' && await has('model.safetensors') && await has('audiovae.pth')) {
      type = 'voxcpm'; name = 'VoxCPM'; needsReference = true;
    } else if (await has('cosyvoice3.yaml') && await has('flow.pt') && await has('llm.pt')) {
      type = 'cosyvoice'; name = 'CosyVoice 3'; needsReference = true;
    } else if (await has('model_1250000.safetensors') && await has('vocab.txt')) {
      type = 'f5'; name = 'F5-TTS v1 Base'; needsReference = true;
    }
    if (!type) continue;
    voices.sort((a, b) => a.id.localeCompare(b.id));
    const ancestors = [folder, path.dirname(folder), path.dirname(path.dirname(folder))];
    let pythonPath = '', sdkPath = '', vocoderDir = '';
    for (const ancestor of ancestors) {
      if (!pythonPath) for (const rel of ['.venv/Scripts/python.exe', '.venv/bin/python', `${type}-runtime/Scripts/python.exe`, `${type}-runtime/bin/python`, 'venv/Scripts/python.exe', 'venv/bin/python', 'runtime/python.exe', 'python.exe']) {
        if (await exists(path.join(ancestor, rel))) { pythonPath = path.join(ancestor, rel); break; }
      }
      if (!sdkPath && await exists(path.join(ancestor, 'CosyVoice/cosyvoice/cli/cosyvoice.py'))) sdkPath = path.join(ancestor, 'CosyVoice');
      if (!vocoderDir && await exists(path.join(ancestor, 'vocos-model/config.yaml')) && await exists(path.join(ancestor, 'vocos-model/pytorch_model.bin'))) vocoderDir = path.join(ancestor, 'vocos-model');
    }
    const presets = await json(path.join(folder, 'dsh-voices.json'));
    const referenceVoices = [];
    for (const v of (Array.isArray(presets.voices) ? presets.voices : []).slice(0, 100)) {
      if (typeof v.id !== 'string' || typeof v.referenceAudio !== 'string' || typeof v.promptText !== 'string' || !v.promptText.trim()) fail('dsh-voices.json 音色配置不完整。');
      const audio = await realpath(path.resolve(folder, v.referenceAudio));
      if (!within(folder, audio) || !await exists(audio)) fail('音色预设中的参考音频必须位于模型文件夹内。');
      referenceVoices.push({ id: v.id, name: v.name || v.id, referenceAudio: audio, promptText: v.promptText });
    }
    models.push({ name, needsReference, voices, referenceVoices, config: { engine: 'folder', mode: 'process', launchPreset: 'folder', modelType: type, modelDir: folder, pythonPath, sdkPath: type === 'cosyvoice' ? sdkPath : '', vocoderDir: type === 'f5' ? vocoderDir : '', voice: needsReference ? 'default' : (voices[0]?.id || 'default') } });
  }
  if (!models.length) fail('未识别到支持的模型。可识别 Kokoro、Qwen3 CustomVoice、F5 v1 Base、VoxCPM、CosyVoice 3；IndexTTS / GPT-SoVITS 请使用已有引擎入口，其他服务可使用通用接口。');
  return { models, layoutOnly: true };
}
