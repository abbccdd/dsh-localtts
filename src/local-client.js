// Embedded into the upstream Harness module-loader bundle by tools/build-client.mjs.
function createLocalController() {
  const clientId = globalThis.crypto?.randomUUID?.() || 'client_' + Math.random().toString(36).slice(2) + Date.now();
  let sessionId = '', configured = '', remoteConfig = null, epoch = 0, busy = false, operations = Promise.resolve();
  let nodes = new Set(), received = new Set(), acknowledgements = [], nextTime = 0, currentJob = null;
  const defaults = { mode: 'process', launchPreset: 'webui', engine: 'indextts', pythonPath: '', projectPath: '', modelDir: '', presetsRoot: '', device: '', apiScript: '', ttsConfig: '', referenceAudio: '', promptText: '', promptLang: 'zh', textLang: 'zh', durationFactor: 1, speedFactor: 1, port: 9880, command: '', args: [], cwd: '', voice: 'default', startupTimeoutMs: 300000, timeoutMs: 180000, autoStart: true, debug: false,
    webuiMode: 'auto', webuiEndpoint: '', webuiVariant: 'standard', gptVersion: '', gptModel: '', sovitsModel: '', engineProfiles: {},
    modelType: '', sdkPath: '', vocoderDir: '', language: 'Chinese', modelChoices: [], modelVoices: [], referenceVoices: [], voicePresets: [],
    endpoint: '', httpPreset: 'openai', protocol: 'auto', model: '', speechPath: '/v1/audio/speech', healthPath: '', healthMode: 'json', voicesPath: '/v1/audio/voices', requestEncoding: 'json',
    requestBody: '{"text":"{{text}}"}', extraBody: '{}', audioFiles: '{}', responseAudio: 'auto', sampleRate: 24000, channels: 1, audioBase64Path: '', apiKeyEnv: '', allowLan: false };
  const genericDefaults = { mode: 'http', launchPreset: 'custom', engine: 'generic', protocol: 'openai-speech' };
  // Presets are configuration data. They all use the same HTTP provider.
  const httpPresets = {
    openai: { endpoint: '', model: '', voice: 'default' },
    kokoro: { endpoint: 'http://127.0.0.1:8880', model: 'kokoro', voice: 'af_heart' },
    piper: { endpoint: 'http://127.0.0.1:5000', protocol: 'custom-http', speechPath: '/synthesize', healthPath: '/info', healthMode: 'http', voicesPath: '/voices', requestBody: '{"text":"{{text}}","voice":"{{voice}}"}' },
    'piper-legacy': { endpoint: 'http://127.0.0.1:5000', protocol: 'custom-http', speechPath: '/', voicesPath: '' },
    fish: { endpoint: 'http://127.0.0.1:8080', protocol: 'custom-http', speechPath: '/v1/tts', healthPath: '/v1/health', voicesPath: '',
      requestBody: '{"text":"{{text}}","reference_id":"{{voice}}","format":"wav","streaming":false}' },
    gpt: { endpoint: 'http://127.0.0.1:9880', protocol: 'custom-http', speechPath: '/tts', voicesPath: '',
      requestBody: '{"text":"{{text}}","text_lang":"zh","ref_audio_path":"","prompt_text":"","prompt_lang":"zh","media_type":"wav","streaming_mode":false}' },
    custom: { endpoint: '', protocol: 'custom-http', speechPath: '/synthesize', voicesPath: '' },
  };
  shared.localProcess = { ...defaults, engineProfiles: {} };
  // `local-runtime` is retained as an internal compatibility alias for older
  // persisted settings and older bundled test harnesses.
  shared.localRuntime = shared.localProcess;
  const isProcessProvider = provider => provider === 'indextts-process' || provider === 'gpt-sovits-process' || provider === 'local-runtime';
  let discoveryTicket = 0, discoveryResult = null, pendingDiscovery = null;
  const launchReady = () => {
    const c = shared.localProcess;
    if (c.engine === 'folder') return !!c.modelType && !!c.modelDir.trim() && !!c.pythonPath.trim() &&
      (!['f5', 'voxcpm', 'cosyvoice'].includes(c.modelType) || !!c.referenceAudio.trim() && !!c.promptText.trim()) &&
      (c.modelType !== 'f5' || !!c.vocoderDir.trim()) && (c.modelType !== 'cosyvoice' || !!c.sdkPath.trim()) && !!c.voice.trim();
    if (c.engine === 'generic') {
      if (c.mode === 'process') return !!c.command.trim();
      if (!c.endpoint?.trim() || (c.protocol === 'openai-speech' && !c.model.trim())) return false;
      try { for (const key of ['requestBody', 'extraBody', 'audioFiles']) JSON.parse(c[key]); } catch { return false; }
      return c.protocol !== 'custom-http' || c.requestBody.includes('{{text}}');
    }
    if (shared.provider === 'local-runtime' && c.endpoint) return true;
    if (c.launchPreset === 'webui') return !!(c.engine === 'gpt-sovits' ? c.referenceAudio.trim() : c.voice.trim() && c.voice !== 'default') &&
      (c.webuiMode === 'attach' ? !!c.webuiEndpoint.trim() : !!c.projectPath.trim() && (c.engine === 'gpt-sovits' || !!c.modelDir.trim()));
    if (c.launchPreset !== 'builtin') return !!c.command.trim();
    return !!c.projectPath.trim() && (c.engine === 'gpt-sovits'
      ? !!c.apiScript.trim() && !!c.referenceAudio.trim()
      : !!c.modelDir.trim() && !!c.voice.trim() && c.voice !== 'default');
  };
  function resetLaunch() {
    const c = shared.localProcess;
    for (const key of ['pythonPath', 'modelDir', 'presetsRoot', 'device', 'apiScript', 'ttsConfig', 'referenceAudio', 'promptText', 'command', 'args', 'cwd', 'voice', 'launchPreset', 'webuiEndpoint', 'gptVersion', 'gptModel', 'sovitsModel']) c[key] = defaults[key];
    delete c.endpoint;
    discoveryResult = null;
  }
  function updateSetting(key, value) {
    const c = shared.localProcess;
    if (c[key] === value) return;
    if (['modelChoices', 'modelVoices', 'referenceVoices', 'voicePresets'].includes(key)) { c[key] = value; saveSettings(); notify(); return; }
    stopSpeaking(); discoveryTicket++;
    if (key === 'projectPath') resetLaunch();
    if (key === 'modelDir' && c.engine === 'folder') {
      Object.assign(c, { modelType: '', pythonPath: '', sdkPath: '', vocoderDir: '', modelChoices: [], modelVoices: [], referenceVoices: [], voice: 'default' });
    }
    if (key === 'launchPreset') { c.command = ''; c.args = []; c.cwd = ''; c.autoStart = true; delete c.endpoint; }
    c[key] = value;
    if (key === 'voice' && c.engine === 'gpt-sovits') c.referenceAudio = value === 'default' ? '' : value;
    if (key === 'referenceAudio' && c.engine !== 'folder') c.voice = value || 'default';
    invalidateConfiguration(); saveSettings(); notify();
  }
  function selectEngine(engine) {
    if (!['indextts', 'gpt-sovits', 'generic', 'folder'].includes(engine)) return;
    stopSpeaking(); discoveryTicket++;
    const c = shared.localProcess;
    if (c.engine !== engine) {
      const profiles = c.engineProfiles && typeof c.engineProfiles === 'object' && !Array.isArray(c.engineProfiles)
        ? { ...c.engineProfiles } : {};
      const current = {};
      for (const key of Object.keys(defaults)) if (key !== 'engineProfiles' && Object.hasOwn(c, key)) current[key] = c[key];
      if (typeof c.endpoint === 'string') current.endpoint = c.endpoint;
      profiles[c.engine] = current;
      const saved = profiles[engine];
      const restored = saved && typeof saved === 'object' && !Array.isArray(saved) && saved.engine === engine
        ? { ...defaults, ...saved, engineProfiles: profiles }
        : { ...defaults, ...(engine === 'generic' ? genericDefaults : {}), ...(engine === 'folder' ? { launchPreset: 'folder' } : {}), engine, engineProfiles: profiles };
      for (const key of Object.keys(c)) delete c[key];
      Object.assign(c, restored);
      discoveryResult = null;
      pendingDiscovery = null;
    }
    c.engine = engine;
    shared.provider = ['generic', 'folder'].includes(engine) ? 'local-runtime' : (engine === 'gpt-sovits' ? 'gpt-sovits-process' : 'indextts-process');
    invalidateConfiguration(); saveSettings(); notify();
  }
  function applyHttpPreset(name) {
    if (!Object.hasOwn(httpPresets, name) || shared.localProcess.engine !== 'generic') return;
    stopSpeaking(); discoveryTicket++;
    const c = shared.localProcess;
    for (const key of ['protocol', 'model', 'voice', 'speechPath', 'healthPath', 'healthMode', 'voicesPath', 'requestEncoding', 'requestBody', 'extraBody', 'audioFiles', 'responseAudio', 'sampleRate', 'channels', 'audioBase64Path', 'apiKeyEnv', 'allowLan']) c[key] = defaults[key];
    Object.assign(c, genericDefaults, httpPresets[name], { httpPreset: name });
    invalidateConfiguration(); saveSettings(); notify();
  }
  const characterKeys = ['referenceAudio', 'gptModel', 'sovitsModel', 'gptVersion', 'promptText', 'promptLang'];
  function selectCharacter(id) {
    const c = shared.localProcess;
    if (c.engine !== 'gpt-sovits' || c.launchPreset !== 'webui' || discoveryResult?.engine !== c.engine || discoveryResult?.projectPath !== c.projectPath) return false;
    const selected = discoveryResult.candidates?.characters?.find(v => v.id === id);
    if (!selected || !characterKeys.every(key => typeof selected.config?.[key] === 'string' && selected.config[key])) return false;
    // Commit the model pair and its reference together; never send a partially
    // switched character to an already configured Auto Read session.
    stopSpeaking(); discoveryTicket++;
    for (const key of characterKeys) c[key] = selected.config[key];
    c.voice = c.referenceAudio;
    invalidateConfiguration(); saveSettings(); notify();
    return true;
  }
  function discover() {
    const c = shared.localProcess, key = JSON.stringify(c), provider = shared.provider;
    // A blur followed by a button click must not scan the same folder twice.
    if (pendingDiscovery?.config === c && pendingDiscovery.key === key && pendingDiscovery.provider === provider && pendingDiscovery.ticket === discoveryTicket) return pendingDiscovery.promise;
    const ticket = ++discoveryTicket;
    const current = () => ticket === discoveryTicket && shared.localProcess === c && JSON.stringify(c) === key && shared.provider === provider;
    const promise = (async () => {
      try {
        const result = await rpc('discover', { engine: c.engine, projectPath: c.projectPath });
        if (!current()) return null;
        stopSpeaking();
        // Fill gaps only: rescanning an unchanged project preserves overrides.
        for (const [name, value] of Object.entries(result.config || {})) {
          if (name === 'projectPath' || (Object.hasOwn(defaults, name) && (!c[name] || (name === 'voice' && c[name] === 'default')))) c[name] = value;
        }
        if (c.engine === 'gpt-sovits' && c.referenceAudio) c.voice = c.referenceAudio;
        discoveryResult = { ...result, engine: c.engine, projectPath: c.projectPath };
        invalidateConfiguration(); saveSettings(); notify();
        return discoveryResult;
      } catch (e) { if (current()) throw e; return null; }
      finally { if (pendingDiscovery?.ticket === ticket) pendingDiscovery = null; }
    })();
    pendingDiscovery = { config: c, key, provider, ticket, promise };
    return promise;
  }
  const enqueue = fn => (operations = operations.catch(() => {}).then(fn));
  function invalidateConfiguration() {
    configured = '';
    // Also disable the Host's previous Auto Read snapshot while a new folder
    // is incomplete. A pending configure is drained before this operation.
    enqueue(async () => {
      configured = '';
      const previous = remoteConfig; remoteConfig = null;
      if (previous) {
        if (previous.config.engine === 'folder') await rpc('unload');
        else await rpc('configure', { ...previous, autoRead: false });
      }
    }).catch(() => {});
  }
  async function rpc(action, payload = {}) {
    const response = await fetch('/dsh-local-ai-tts-api/local-runtime', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, clientId, ...payload }),
      signal: AbortSignal.timeout(['status', 'load'].includes(action) ? Math.max(payload.config?.startupTimeoutMs || 0, (payload.config?.timeoutMs || 120000) * 2) + 15000 : 15000),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `TTS HTTP ${response.status}`);
    return data;
  }
  function snapshot() {
    const config = { ...shared.localProcess, engine: shared.provider === 'gpt-sovits-process' ? 'gpt-sovits' : (shared.provider === 'local-runtime' ? (shared.localProcess.engine || 'indextts') : 'indextts') };
    for (const key of ['engineProfiles', 'modelChoices', 'modelVoices', 'referenceVoices', 'voicePresets']) delete config[key];
    if (shared.provider === 'local-runtime' && !['generic', 'folder'].includes(config.engine) && config.endpoint) { delete config.mode; }
    return { config, sessionId, autoRead: isProcessProvider(shared.provider) && shared.autoRead && localAutoAllowed() };
  }
  async function configure() {
    const value = snapshot(), key = JSON.stringify(value);
    if (key !== configured) { await rpc('configure', value); remoteConfig = value; configured = key; }
  }
  function resetAudio() {
    for (const node of nodes) { node.onended = null; try { node.stop(); node.disconnect(); } catch {} }
    nodes.clear(); received.clear(); acknowledgements = []; nextTime = 0; currentJob = null;
  }
  function stop() {
    epoch++; resetAudio();
    if (configured) enqueue(() => rpc('stop')).catch(() => {});
  }
  function sync() {
    if (!isProcessProvider(shared.provider) || !launchReady()) {
      if (configured || remoteConfig) { stop(); invalidateConfiguration(); }
      return;
    }
    enqueue(() => { if (isProcessProvider(shared.provider) && launchReady()) return configure(); }).catch(e => showToast(e.message, 'error'));
  }
  function session(value) {
    if (sessionId !== value) { if (shared.speakSource === 'auto') stopSpeaking(); sessionId = value || ''; sync(); }
  }
  async function read(text, onError) {
    const version = epoch;
    try {
      return await enqueue(async () => {
        await configure();
        if (version !== epoch) return { ok: false };
        await rpc('read', { text });
        return { ok: true };
      });
    } catch (e) {
      if (version === epoch) { clearSpeaking(shared.speakToken); (onError || (m => showToast(m, 'error')))(e.message); }
      return { ok: false, error: e.message };
    }
  }
  async function play(item, job, version) {
    if (job.source === 'auto' && !localAutoAllowed()) return;
    const key = job.jobId + ':' + item.index;
    if (received.has(key)) return;
    received.add(key);
    let audioContext = shared.audioCtx;
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audio is unavailable in this browser.');
      audioContext = shared.audioCtx = new Context();
    }
    if (!shared.paused) await audioContext.resume();
    const bytes = Uint8Array.from(atob(item.data), c => c.charCodeAt(0));
    const buffer = await audioContext.decodeAudioData(bytes.buffer);
    if (version !== epoch || (job.source === 'auto' && !localAutoAllowed())) return;
    if (!shared.speaking) { shared.speakToken++; shared.speaking = true; shared.speakSource = job.source; }
    const token = shared.speakToken;
    shared.waCleanup = resetAudio;
    shared.chunkProgress = { index: item.index, total: job.done ? item.index : '?' };
    const source = audioContext.createBufferSource(); source.buffer = buffer;
    source.connect(audioContext.destination); nodes.add(source);
    source.onended = () => {
      nodes.delete(source); source.disconnect();
      if (version === epoch) acknowledgements.push({ jobId: job.jobId, index: item.index });
      if (version === epoch && currentJob?.done && !nodes.size && token === shared.speakToken) {
        acknowledgements.push({ jobId: job.jobId, index: item.index, finished: true });
        shared.waCleanup = null; clearSpeaking(token);
      }
    };
    const start = Math.max(audioContext.currentTime + 0.025, nextTime);
    source.start(start); nextTime = start + buffer.duration; notify();
  }
  async function poll() {
    refreshCoexistence();
    if (busy || !isProcessProvider(shared.provider) || !configured) return;
    busy = true; const version = epoch;
    const acks = acknowledgements.splice(0);
    try {
      await operations;
      if (version !== epoch) return;
      const data = await rpc('poll', { acknowledgements: acks });
      if (version !== epoch) return;
      // The Host retains at most three unacknowledged segments per browser.
      for (const job of data.jobs || []) {
        currentJob = job;
        if (job.error) {
          const key = job.jobId + ':error';
          if (!received.has(key)) { received.add(key); showToast(job.error.message, 'error'); }
        }
        for (const item of job.audio) await play(item, job, version);
        if (job.done && !nodes.size) {
          acknowledgements.push({ jobId: job.jobId, index: Number.MAX_SAFE_INTEGER, finished: true });
          if (isProcessProvider(shared.provider)) { shared.waCleanup = null; clearSpeaking(shared.speakToken); }
          received.clear(); nextTime = 0;
        }
      }
    } catch (e) {
      if (version === epoch) {
        stopSpeaking(); configured = ''; showToast(e.message || 'Local process playback failed.', 'error');
      }
    } finally { busy = false; }
  }
  function Settings() {
    useSharedForce();
    const [, render] = react.useState(0);
    const [status, setStatus] = react.useState('');
    const [testing, setTesting] = react.useState(false);
    const [detecting, setDetecting] = react.useState(false);
    const [voices, setVoices] = react.useState([]);
    const [trialText, setTrialText] = react.useState('你好，这是本地语音测试。');
    const [browser, setBrowser] = react.useState(null);
    const browserTicket = react.useRef(0);
    const [presetName, setPresetName] = react.useState('');
    const revision = react.useRef(0), scanRevision = react.useRef(0);
    const c = shared.localProcess;
    const webui = c.launchPreset === 'webui';
    const audioValue = c.engine === 'gpt-sovits' ? c.referenceAudio : (c.voice === 'default' ? '' : c.voice);
    react.useEffect(() => {
      revision.current++; scanRevision.current++;
      setStatus(''); setVoices([]); setDetecting(false);
    }, [c, c.engine, shared.provider]);
    const zh = window.__dshLocalAiTtsI18n?.current() !== 'en';
    const label = (en, cn) => zh ? cn : en;
    const h = react.createElement;
    const detected = discoveryResult?.engine === c.engine && discoveryResult?.projectPath === c.projectPath ? discoveryResult : null;
    const gptCharacters = webui && c.engine === 'gpt-sovits' ? detected?.candidates?.characters || [] : [];
    const selectedCharacter = gptCharacters.find(v => characterKeys.every(key => v.config?.[key] === c[key]));
    const change = (key, value) => {
      revision.current++; scanRevision.current++; setDetecting(false);
      updateSetting(key, value); setStatus('');
      if (key === 'projectPath' || key === 'modelDir') setVoices([]);
      render(n => n + 1);
    };
    const scan = async () => {
      if (!c.projectPath.trim()) return;
      const version = ++scanRevision.current;
      setDetecting(true); setStatus(label('Finding files…', '正在查找文件…'));
      try {
        const result = await discover();
        if (version !== scanRevision.current) return;
        setStatus(result ? label('Paths detected; runtime and model dependencies are not tested yet.', '路径已识别；尚未验证运行环境及模型依赖。') : '');
        render(n => n + 1);
      } catch (e) { if (version === scanRevision.current) setStatus(e.message); }
      finally { if (version === scanRevision.current) setDetecting(false); }
    };
    const field = (title, element) => h('label', { style: { display: 'grid', gap: 6 } }, h('span', null, title), element);
    const input = (key, props = {}) => h('input', {
      className: 'dsh-local-ai-tts-preview-input', style: { width: '100%', boxSizing: 'border-box' },
      value: c[key], spellCheck: false, onChange: e => change(key, e.target.value), ...props,
    });
    const note = text => h('p', { className: 'dsh-local-ai-tts-module-desc', style: { margin: 0, overflowWrap: 'anywhere' } }, text);
    const playbackControls = () => shared.speaking ? h('div', { role: 'group', 'aria-label': label('Playback controls', '播放控制'), style: { display: 'flex', gap: 8 } },
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: togglePause }, shared.paused ? t('mini.resume') : t('mini.pause')),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: stopSpeaking }, t('stopRead'))) : null;
    const engineSelector = field(label('Engine', '引擎'), h('select', { className: 'dsh-local-ai-tts-select', value: c.engine, onChange: e => {
      revision.current++; scanRevision.current++; selectEngine(e.target.value);
      setStatus(''); setVoices([]); setDetecting(false); render(n => n + 1);
    } }, h('option', { value: 'indextts' }, 'IndexTTS 2.5'), h('option', { value: 'gpt-sovits' }, 'GPT-SoVITS'),
    h('option', { value: 'folder' }, label('Local model folder', '本地模型文件夹（自动识别）')),
    h('option', { value: 'generic' }, label('Universal local TTS', '通用本地 TTS（高级协议接入）'))));
    if (c.engine === 'folder') {
      const needsReference = ['f5', 'voxcpm', 'cosyvoice'].includes(c.modelType);
      const chooseModel = (model, choices = c.modelChoices) => {
        stopSpeaking(); discoveryTicket++; revision.current++; setVoices([]);
        const config = { ...model.config };
        if (c.modelType === config.modelType && c.modelDir === config.modelDir) {
          for (const key of ['pythonPath', 'sdkPath', 'vocoderDir']) if (c[key]) config[key] = c[key];
          if (model.voices.some(v => v.id === c.voice)) config.voice = c.voice;
        }
        Object.assign(c, config, { modelChoices: choices, modelVoices: model.voices, referenceVoices: model.referenceVoices });
        invalidateConfiguration(); saveSettings(); notify(); setStatus(label('Folder recognized. Load the model to verify the environment.', '已识别文件夹，请加载模型验证运行环境。')); render(n => n + 1);
      };
      const recognize = async () => {
        const version = ++scanRevision.current, key = c.modelDir;
        setDetecting(true); setStatus(label('Recognizing model files…', '正在识别模型文件…'));
        try {
          const result = await rpc('discover-model', { modelDir: key });
          if (version !== scanRevision.current || shared.localProcess !== c || c.modelDir !== key || c.engine !== 'folder') return;
          if (result.models.length === 1) chooseModel(result.models[0], result.models);
          else { change('modelChoices', result.models); setStatus(label('Several models found. Choose one below.', '找到多个模型，请在下方选择。')); }
        } catch (e) { if (version === scanRevision.current) setStatus(e.message); }
        finally { if (version === scanRevision.current) setDetecting(false); }
      };
      const browse = async folder => {
        const ticket = ++browserTicket.current;
        setBrowser({ loading: true, folder: '', parent: '', folders: [] });
        try { const result = await rpc('browse-folders', { folder }); if (ticket === browserTicket.current && c.engine === 'folder') setBrowser(result); }
        catch (e) { if (ticket === browserTicket.current) { setBrowser(null); setStatus(e.message); } }
      };
      const loadModel = async () => {
        const version = revision.current, key = JSON.stringify(c);
        setTesting(true); setStatus(label('Loading model… The first load can take several minutes.', '正在加载模型…首次加载可能需要几分钟。'));
        try {
          await enqueue(async () => {
            if (version !== revision.current || key !== JSON.stringify(c) || shared.localProcess !== c || c.engine !== 'folder') return;
            await configure();
            if (version !== revision.current || key !== JSON.stringify(c) || shared.localProcess !== c || c.engine !== 'folder') return;
            const result = await rpc('load', snapshot());
            if (version !== revision.current || key !== JSON.stringify(c) || shared.localProcess !== c || c.engine !== 'folder') return;
            setVoices(result.voices || []);
            setStatus(label('Model ready. You can try reading now.', '模型已就绪，可以试听。'));
          });
        } catch (e) { if (version === revision.current) setStatus(e.message); }
        finally { setTesting(false); }
      };
      const availableVoices = voices.length ? voices : c.modelVoices;
      const references = [...c.referenceVoices, ...c.voicePresets];
      return h('section', { 'aria-label': label('Local model folder', '本地模型文件夹'), className: 'dsh-local-ai-tts-module dsh-local-ai-tts-module-stack', style: { display: 'grid', gap: 16, width: '100%' }, 'aria-busy': detecting || testing },
        h('strong', null, label('Local model folder', '本地模型文件夹')), engineSelector,
        note(label('Choose downloaded model files. Existing Python dependencies are reused; no API server is required. IndexTTS and GPT-SoVITS retain their own engine entries.', '选择已下载的模型文件夹，复用已有 Python 环境，无需先启动 API 服务。IndexTTS 和 GPT-SoVITS 继续使用各自的引擎入口。')),
        field(label('Model folder', '模型文件夹'), input('modelDir', { disabled: testing, placeholder: label('Absolute path on the Host computer', '运行 DSH 的电脑上的文件夹完整路径') })),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: detecting || testing, onClick: () => browse(c.modelDir || '') }, label('Choose folder', '选择文件夹')),
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: detecting || testing || !c.modelDir.trim(), onClick: recognize }, detecting ? label('Recognizing…', '识别中…') : label('Recognize folder', '识别文件夹'))),
        browser ? h('div', { role: 'region', 'aria-label': label('Folder browser', '文件夹浏览器'), style: { display: 'grid', gap: 8, padding: 12, border: '1px solid currentColor', borderRadius: 8 } },
          note(browser.loading ? label('Loading folders…', '正在读取文件夹…') : browser.folder || label('Choose a drive', '请选择磁盘')),
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: browser.loading, onClick: () => browse(browser.parent) }, label('Parent folder', '上一级')),
          h('div', { style: { maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 } }, ...browser.folders.map(f => h('button', { key: f.path, type: 'button', className: 'dsh-local-ai-tts-browse', style: { textAlign: 'left', overflowWrap: 'anywhere' }, onClick: () => browse(f.path) }, f.name))),
          browser.truncated ? note(label('First 200 folders shown. Paste a path to open other folders.', '仅显示前 200 个文件夹，其他文件夹可直接粘贴路径。')) : null,
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: browser.loading || !browser.folder, onClick: () => { browserTicket.current++; change('modelDir', browser.folder); setBrowser(null); } }, label('Use this folder', '使用此文件夹')),
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: () => { browserTicket.current++; setBrowser(null); } }, label('Close', '关闭'))) : null,
        c.modelChoices.length > 1 ? field(label('Recognized models', '识别到的模型'), h('select', { className: 'dsh-local-ai-tts-select', disabled: testing, value: c.modelType ? c.modelDir : '', onChange: e => { const model = c.modelChoices.find(m => m.config.modelDir === e.target.value); if (model) chooseModel(model); } }, h('option', { value: '' }, label('Choose a model', '请选择模型')), ...c.modelChoices.map(m => h('option', { key: m.config.modelDir, value: m.config.modelDir }, m.name + ' · ' + m.config.modelDir)))) : null,
        c.modelType ? note(label('Recognized model: ', '已识别模型：') + c.modelType + (c.pythonPath ? label(' · Python environment found', ' · 已找到 Python 环境') : label(' · Set Python in Environment settings', ' · 请在环境设置中指定 Python'))) : null,
        needsReference ? h('div', { style: { display: 'grid', gap: 12 } },
          note(label('This model needs reference audio and its matching transcript. Save them once as a voice preset.', '该模型需要参考音频和对应原文，填写后可保存为音色预设，供其他克隆模型复用。')),
          references.length ? field(label('Saved voices', '已保存音色'), h('select', { className: 'dsh-local-ai-tts-select', disabled: testing, value: '', onChange: e => { const v = references[Number(e.target.value)]; if (!v) return; change('referenceAudio', v.referenceAudio); change('promptText', v.promptText); } }, h('option', { value: '' }, label('Choose a voice', '请选择音色')), ...references.map((v, i) => h('option', { key: i, value: String(i) }, v.name)))) : null,
          field(label('Reference audio path', '参考音频路径'), input('referenceAudio', { disabled: testing })), field(label('Reference transcript', '参考音频原文'), input('promptText', { disabled: testing })),
          field(label('Voice preset name', '音色预设名称'), h('input', { className: 'dsh-local-ai-tts-preview-input', value: presetName, onChange: e => setPresetName(e.target.value) })),
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: !presetName.trim() || !c.referenceAudio.trim() || !c.promptText.trim() || testing, onClick: () => {
            const preset = { id: presetName.trim(), name: presetName.trim(), referenceAudio: c.referenceAudio, promptText: c.promptText };
            change('voicePresets', [...c.voicePresets.filter(v => v.id !== preset.id), preset]); setStatus(label('Voice preset saved in this browser.', '音色预设已保存在当前浏览器。'));
          } }, label('Save voice preset', '保存音色预设'))) : availableVoices.length ? field(label('Preset voice', '预设音色'), h('select', { className: 'dsh-local-ai-tts-select', disabled: testing, value: c.voice, onChange: e => change('voice', e.target.value) }, ...availableVoices.map(v => h('option', { key: v.id, value: v.id }, v.name)))) : null,
        h('details', null, h('summary', { style: { cursor: 'pointer', padding: '10px 0' } }, label('Environment settings', '环境设置（识别不完整时展开）')),
          h('div', { style: { display: 'grid', gap: 12 } },
            field(label('Python executable with model dependencies', '已安装模型依赖的 Python 程序'), input('pythonPath', { disabled: testing })),
            c.modelType === 'f5' ? field(label('Vocos vocoder folder', 'Vocos 声码器文件夹'), input('vocoderDir', { disabled: testing })) : null,
            c.modelType === 'cosyvoice' ? field(label('CosyVoice source folder', 'CosyVoice 源码文件夹'), input('sdkPath', { disabled: testing })) : null,
            field(label('Device', '运算设备'), h('select', { className: 'dsh-local-ai-tts-select', value: c.device || 'auto', disabled: testing, onChange: e => change('device', e.target.value) }, ...[['auto', label('Automatic', '自动')], ['cuda', 'CUDA'], ['cpu', 'CPU']].map(([id, name]) => h('option', { key: id, value: id }, name)))),
            c.modelType === 'qwen3' ? field(label('Language', '合成语言'), h('select', { className: 'dsh-local-ai-tts-select', value: c.language, disabled: testing, onChange: e => change('language', e.target.value) }, ...[['Chinese', '中文'], ['English', '英语'], ['Japanese', '日语'], ['Korean', '韩语'], ['Auto', '自动']].map(([id, name]) => h('option', { key: id, value: id }, label(id, name))))) : null,
            ['kokoro', 'f5', 'cosyvoice'].includes(c.modelType) ? field(label('Speech speed', '语速'), input('speedFactor', { type: 'number', min: 0.6, max: 1.65, step: 0.05, disabled: testing, onChange: e => change('speedFactor', Number(e.target.value)) })) : null,
            field(label('Startup timeout (ms)', '启动超时（毫秒）'), input('startupTimeoutMs', { type: 'number', min: 1000, max: 600000, disabled: testing, onChange: e => change('startupTimeoutMs', Number(e.target.value)) })),
            field(label('Synthesis timeout (ms)', '合成超时（毫秒）'), input('timeoutMs', { type: 'number', min: 100, max: 600000, disabled: testing, onChange: e => change('timeoutMs', Number(e.target.value)) })))),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: testing || detecting || !launchReady(), onClick: loadModel }, testing ? label('Loading…', '加载中…') : label('Load model', '加载模型')),
          h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: testing, onClick: async () => {
            stopSpeaking(); shared.autoRead = false;
            try { await enqueue(async () => { if (remoteConfig) await rpc('unload'); configured = ''; remoteConfig = null; }); saveSettings(); setStatus(label('Model unloaded. Auto Read is off.', '模型已卸载，自动朗读已关闭。')); }
            catch (e) { setStatus(e.message); }
          } }, label('Unload model', '卸载模型'))),
        field(label('Trial text', '试听文本'), h('input', { className: 'dsh-local-ai-tts-preview-input', value: trialText, onChange: e => setTrialText(e.target.value) })),
        h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: testing || detecting || !trialText.trim() || !launchReady() || shared.speaking, onClick: async () => {
          if (!shared.audioCtx) { const Context = window.AudioContext || window.webkitAudioContext; if (!Context) { setStatus(label('Web Audio is unavailable.', '浏览器不支持 Web Audio。')); return; } shared.audioCtx = new Context(); }
          await shared.audioCtx.resume(); const result = await read(trialText, message => setStatus(message)); if (result.ok) setStatus(label('Trial queued.', '试听已入队，正在合成并播放。'));
        } }, label('Trial read', '试听')),
        playbackControls(),
        h('div', { role: 'status', 'aria-live': 'polite', style: { overflowWrap: 'anywhere' } }, status || (c.modelType ? label('Model settings saved. Load or try reading to verify the current model.', '模型设置已保存，可加载或试听验证当前模型。') : label('Choose a folder to begin.', '请选择模型文件夹开始。'))));
    }
    if (c.engine === 'generic') {
      const select = (key, options) => h('select', { className: 'dsh-local-ai-tts-select', value: c[key], onChange: e => change(key, e.target.value) },
        ...options.map(([id, title]) => h('option', { key: id, value: id }, title)));
      const jsonInput = key => h('textarea', { className: 'dsh-local-ai-tts-preview-input', rows: 5, value: c[key], spellCheck: false,
        style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }, onChange: e => change(key, e.target.value) });
      const checkConnection = async () => {
        const version = revision.current, key = JSON.stringify(c), provider = shared.provider;
        const valid = () => version === revision.current && c === shared.localProcess && JSON.stringify(c) === key && provider === shared.provider;
        setTesting(true); setStatus(label('Checking service…', '正在检查服务…'));
        try {
          const data = await rpc('status', { config: snapshot().config });
          if (!valid()) return;
          setVoices(data.voices || []);
          if (c.voice === 'default' && data.voices?.length === 1) change('voice', data.voices[0].id);
          setStatus((data.status === 'unchecked' ? label('No health check configured; use Trial read to verify synthesis.', '未设置健康检查，请点击试听验证合成。')
            : data.status === 'reachable' ? label('Service reachable; use Trial read to verify the model.', '服务可访问，请点击试听验证模型。')
            : data.ready ? label('Service reports ready; synthesis still needs a trial read.', '服务报告已就绪，实际合成仍需试听。') : label('Service not ready: ', '服务尚未就绪：') + data.status) + (data.warning ? ' — ' + data.warning : ''));
        } catch (e) { if (valid()) setStatus(e.message); }
        finally { setTesting(false); }
      };
      return h('section', { 'aria-label': label('Universal local TTS', '通用本地 TTS'), className: 'dsh-local-ai-tts-module dsh-local-ai-tts-module-stack', style: { display: 'grid', gap: 16, width: '100%' } },
        h('strong', null, label('Universal local TTS', '通用本地 TTS')), engineSelector,
        note(label('Connect your installed TTS service by protocol. The Host sends text and receives audio; models stay in your own runtime.', '按协议连接已安装的 TTS 服务。插件发送文本并接收音频，模型由现有服务管理。')),
        field(label('Connection', '连接方式'), select('mode', [['http', 'HTTP API'], ['process', label('JSONL worker', 'JSONL worker 进程')]])),
        c.mode !== 'process' ? h('div', { style: { display: 'grid', gap: 16 } },
          field(label('Preset (fills connection defaults)', '配置预设（填入接口默认值）'), h('select', { className: 'dsh-local-ai-tts-select', value: c.httpPreset, onChange: e => {
            revision.current++; applyHttpPreset(e.target.value); setStatus(''); setVoices([]); render(n => n + 1);
          } }, ...[['openai', label('OpenAI-compatible / LocalAI', 'OpenAI 兼容 / LocalAI')], ['kokoro', 'Kokoro-FastAPI'], ['piper', 'Piper'], ['piper-legacy', label('Piper (older / route)', 'Piper（旧版 / 路由）')], ['fish', 'Fish Speech API'], ['gpt', 'GPT-SoVITS API'], ['custom', label('Custom HTTP', '自定义 HTTP')]].map(([id, title]) => h('option', { key: id, value: id }, title)))),
          field(label('Service base URL', '服务基础地址'), input('endpoint', { placeholder: 'http://127.0.0.1:5000' })),
          field(label('Protocol', '协议'), select('protocol', [['openai-speech', 'OpenAI speech'], ['custom-http', label('Custom HTTP (JSON / form)', '自定义 HTTP（JSON / 表单）')]])),
          field(label('Model ID', '模型 ID'), input('model', { placeholder: label('Required for OpenAI speech', 'OpenAI speech 必填') })),
          field(label('Voice ID', '音色 ID'), input('voice')),
          voices.length ? field(label('Discovered voices', '服务音色列表'), h('select', { className: 'dsh-local-ai-tts-select', value: voices.some(v => v.id === c.voice) ? c.voice : '', onChange: e => { if (e.target.value) change('voice', e.target.value); } },
            h('option', { value: '' }, label('Select…', '请选择…')), ...voices.map(v => h('option', { key: v.id, value: v.id }, v.name)))) : null,
          c.protocol === 'custom-http' ? h('div', { style: { display: 'grid', gap: 12 } },
            field(label('Synthesis route', '合成路由'), input('speechPath')),
            field(label('Request encoding', '请求编码'), select('requestEncoding', [['json', 'JSON'], ['form', 'application/x-www-form-urlencoded'], ['multipart', 'multipart/form-data']])),
            field(label('Request body template (JSON object)', '请求体模板（JSON 对象）'), jsonInput('requestBody')),
            note(label('Use complete values {{text}}, {{voice}}, {{model}}. Text is encoded safely. A reference path inside JSON belongs to the TTS server.', '使用完整字段值 {{text}}、{{voice}}、{{model}}，文本会正确编码。JSON 内的参考音频路径属于 TTS 服务端。')),
            c.requestEncoding === 'multipart' ? field(label('Audio uploads: field → absolute Host audio path (JSON)', '音频上传：字段名 → Host 上音频的完整路径（JSON）'), jsonInput('audioFiles')) : null) : null,
          h('details', null, h('summary', { style: { cursor: 'pointer', padding: '10px 0' } }, label('Advanced HTTP settings', '高级 HTTP 设置')),
            h('div', { style: { display: 'grid', gap: 12 } },
              c.protocol === 'openai-speech' ? field(label('Synthesis route', '合成路由'), input('speechPath')) : null,
              c.protocol === 'openai-speech' ? field(label('Extra synthesis fields (JSON)', '额外合成参数（JSON）'), jsonInput('extraBody')) : null,
              field(label('Health route (optional)', '健康检查路由（可留空）'), input('healthPath')),
              field(label('Health response', '健康检查响应'), select('healthMode', [['json', label('JSON readiness status', 'JSON 就绪状态')], ['http', label('HTTP reachability only', '仅检查 HTTP 可访问')]])),
              field(label('Voices route (optional)', '音色列表路由（可留空）'), input('voicesPath')),
              field(label('Audio response', '音频响应'), select('responseAudio', [['auto', label('WAV / MP3 / Ogg / FLAC', 'WAV / MP3 / Ogg / FLAC')], ['pcm-s16le', label('Raw PCM (s16le)', '裸 PCM（s16le）')]])),
              c.responseAudio === 'pcm-s16le' ? field(label('PCM sample rate (Hz)', 'PCM 采样率（Hz）'), input('sampleRate', { type: 'number', min: 8000, max: 192000, onChange: e => change('sampleRate', Number(e.target.value)) })) : null,
              c.responseAudio === 'pcm-s16le' ? field(label('PCM channels', 'PCM 声道数'), input('channels', { type: 'number', min: 1, max: 2, onChange: e => change('channels', Number(e.target.value)) })) : null,
              field(label('JSON base64 audio field (optional)', 'JSON base64 音频字段（可留空）'), input('audioBase64Path', { placeholder: 'data.audio' })),
              field(label('Bearer key environment variable on Host (optional)', 'Host 上存放 Bearer 密钥的环境变量名（可留空）'), input('apiKeyEnv', { placeholder: 'LOCAL_TTS_API_KEY' })),
              h('label', null, h('input', { type: 'checkbox', checked: c.allowLan, onChange: e => change('allowLan', e.target.checked) }), label('Allow private LAN IPv4 (text and uploaded references leave this computer)', '允许私有局域网 IPv4（文本和上传的参考音频将离开本机）')))))
        : h('div', { style: { display: 'grid', gap: 12 } },
          field(label('Worker executable', 'Worker 可执行程序'), input('command')),
          field(label('Arguments (one per line, without shell quotes)', '启动参数（每行一个，无需 shell 引号）'), h('textarea', { className: 'dsh-local-ai-tts-preview-input', rows: 3, value: c.args.join('\n'),
            style: { width: '100%', boxSizing: 'border-box' }, onChange: e => change('args', e.target.value ? e.target.value.split(/\r?\n/) : []) })),
          field(label('Working directory (optional)', '工作目录（可留空）'), input('cwd')), field(label('Voice ID', '音色 ID'), input('voice')),
          note(label('The command must implement the documented JSONL worker protocol. A normal WebUI/CLI command does not implement it automatically.', '命令必须实现文档中的 JSONL worker 协议，普通 WebUI 或 CLI 命令不会自动具备这个协议。'))),
        field(label('Request timeout (ms)', '请求超时（毫秒）'), input('timeoutMs', { type: 'number', min: 100, max: c.mode === 'process' ? 600000 : 300000, onChange: e => change('timeoutMs', Number(e.target.value)) })),
        c.mode === 'process' ? field(label('Startup timeout (ms)', '启动超时（毫秒）'), input('startupTimeoutMs', { type: 'number', min: 1000, max: 600000, onChange: e => change('startupTimeoutMs', Number(e.target.value)) })) : null,
        h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: testing, onClick: checkConnection }, testing ? label('Checking…', '检查中…') : label('Test Connection', '测试连接')),
        field(label('Trial text', '试听文本'), h('input', { className: 'dsh-local-ai-tts-preview-input', value: trialText, onChange: e => setTrialText(e.target.value) })),
        h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: !trialText.trim() || !launchReady() || shared.speaking, onClick: async () => {
          if (!shared.audioCtx) {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) { setStatus(label('Web Audio is unavailable.', '浏览器不支持 Web Audio。')); return; }
            shared.audioCtx = new Context();
          }
          await shared.audioCtx.resume();
          const result = await read(trialText, message => setStatus(message));
          if (result.ok) setStatus(label('Trial queued; listen to the audio before enabling Auto Read.', '试听已入队，请确认音频播放后再开启自动朗读。'));
        } }, label('Trial read', '试听')),
        playbackControls(),
        h('div', { role: 'status', 'aria-live': 'polite', style: { overflowWrap: 'anywhere' } }, status || label('Not tested', '尚未测试')));
    }
    const choice = (key, title, placeholder) => {
      const options = detected?.candidates?.[key] || [];
      return h('div', { style: { display: 'grid', gap: 6 } },
        field(title, input(key, { placeholder })),
        options.length > 1 ? field(label('Detected candidates — choose one', '检测到多个候选，请选择'),
          h('select', { className: 'dsh-local-ai-tts-select', value: options.includes(c[key]) ? c[key] : '', onChange: e => { if (e.target.value) change(key, e.target.value); } },
            h('option', { value: '' }, label('Select…', '请选择…')), ...options.map(v => h('option', { key: v, value: v }, v)))) : null);
    };
    const warnings = {
      SAVED_MODELS_UNREADABLE: label('Saved GPT model selection could not be read; confirm the pair in Advanced.', '无法读取已保存的 GPT 模型选择，请在高级设置确认模型组合。'),
      SAVED_MODELS_INCOMPLETE: !webui || c.webuiMode === 'attach' || (c.gptVersion && c.gptModel && c.sovitsModel) ? '' : label('weight.json has no complete model pair. Choose a saved character or confirm both weights in Advanced.', 'weight.json 未保存完整模型组合。请选择已保存角色，或在高级设置确认两份权重。'),
      CHARACTER_PRESET_INVALID: label('Some local character configurations are unsupported or refer to missing/out-of-folder files; they were skipped.', '部分本地角色配置格式不支持，或文件缺失／超出目录范围，已跳过。'),
      CHOOSE_CHARACTER: selectedCharacter ? '' : label(webui ? 'Choose a saved character to fill its model pair, reference and transcript together.' : 'Reference audio was found in runtime_voices; select it below and confirm the API model configuration.', webui ? '请选择已保存角色，一次填入模型组合、参考音频和原文。' : '已在 runtime_voices 找到参考音频，请在下方选择，并确认 API 模型配置。'),
      INACCESSIBLE_FILES: label('Some files are inaccessible.', '部分文件无法访问。'),
      MULTIPLE_PYTHONS: c.pythonPath ? '' : label('Several Python environments found; choose in Advanced.', '找到多个 Python 环境，请在高级设置中选择。'),
      PYTHON_NOT_FOUND: c.pythonPath ? '' : label('Python was not found. Set the installed environment in Advanced; otherwise PATH python is used.', '未找到 Python。请在高级设置中指定已安装的环境；留空会使用 PATH 中的 python。'),
      MULTIPLE_MODELS: c.modelDir ? '' : label('Several model directories found; choose in Advanced.', '找到多个模型目录，请在高级设置中选择。'),
      MODEL_NOT_FOUND: c.modelDir ? '' : label('No model config found; specify the model directory in Advanced.', '未找到模型配置，请在高级设置中指定模型目录。'),
      OTHER_INDEX_VERSION: label('Non-2.5 model configs were skipped.', '已跳过非 2.5 版本的模型配置。'),
      MODEL_VERSION_UNCONFIRMED: label('A config has no version marker; confirm it is for IndexTTS 2.5.', '有配置未声明版本，请确认它属于 IndexTTS 2.5。'),
      TTS_CONFIG_NOT_FOUND: c.ttsConfig ? '' : label('Default tts_infer.yaml missing; specify an existing inference YAML in Advanced.', '默认 tts_infer.yaml 缺失，请在高级设置中指定已有推理配置。'),
      REFERENCE_NOT_FOUND: c.voice !== 'default' && c.voice ? '' : label('No reference audio found; enter an existing audio path.', '未找到参考音频，请填写已有音频路径。'),
      CHOOSE_REFERENCE: c.voice !== 'default' && c.voice ? '' : label('Several reference audios found; select the intended voice.', '找到多个参考音频，请选择想使用的音色。'),
      AUDIO_LIST_TRUNCATED: label('Audio search limit reached; enter an unlisted audio path manually.', '音频候选已达扫描上限；未列出的音频可手动填写路径。'),
    };
    // IndexTTS presets are character voices, even though the official WebUI
    // exposes them as a prompt.wav path. Keep the real path as the option
    // value (the Host needs it) but present a character name to the user. A
    // matching voice_cache lets the official backend reuse the preset without
    // decoding the prompt file again.
    const characterName = value => {
      const text = String(value?.name || value?.id || '').replace(/\\/g, '/');
      const match = text.match(/(?:^|\/)outputs\/presets\/([^/]+)\/prompt\.wav$/i);
      return match ? match[1] : '';
    };
    const audioLabel = value => {
      const character = characterName(value);
      if (character) return label(`${character} (saved character voice)`, `${character}（已保存角色音色）`);
      const name = String(value?.name || value?.id || '');
      return /^examples[\\/]/i.test(name)
        ? label(`Official example: ${name}`, `官方示例：${name}`)
        : name;
    };
    const audioOptions = [...new Map([...(detected?.candidates?.voices || []), ...voices]
      .filter(v => v.id && v.id !== 'default').map(v => [v.id, v])).values()]
      .sort((a, b) => {
        const ar = !!characterName(a), br = !!characterName(b);
        if (ar !== br) return ar ? -1 : 1;
        return audioLabel(a).localeCompare(audioLabel(b), undefined, { numeric: true });
      });
    const characterOptions = audioOptions.filter(v => characterName(v));
    const otherAudioOptions = audioOptions.filter(v => !characterName(v) && !gptCharacters.some(role => role.config.referenceAudio === v.id));
    const referenceTitle = c.engine === 'indextts' && characterOptions.length
      ? label('Character preset path (auto-filled)', '角色预设路径（自动填充）')
      : label('Reference audio path (required)', '参考音频路径（必填）');
    const languageOptions = c.engine === 'indextts'
      ? [['ZH', label('Chinese', '中文')], ['EN', label('English', '英语')], ['JA', label('Japanese', '日语')], ['AR', label('Arabic', '阿拉伯语')], ['ES', label('Spanish', '西班牙语')]]
      : [['zh', label('Chinese', '中文')], ['en', label('English', '英语')], ['ja', label('Japanese', '日语')], ['ko', label('Korean', '韩语')], ['yue', label('Cantonese', '粤语')], ['auto', label('Multilingual', '多语种')]];
    const languageValue = c.engine === 'indextts'
      ? String(c.textLang || 'ZH').toUpperCase()
      : String(c.textLang || 'zh');
    const speedKey = c.engine === 'indextts' ? 'durationFactor' : 'speedFactor';
    const speedValue = Number.isFinite(Number(c[speedKey])) ? Number(c[speedKey]) : 1;
    const speedMin = c.engine === 'indextts' ? 0.5 : 0.6;
    const speedMax = c.engine === 'indextts' ? 2 : 1.65;
    const speedStep = c.engine === 'indextts' ? 0.01 : 0.05;
    return h('section', { 'aria-label': 'Local AI TTS', className: 'dsh-local-ai-tts-module dsh-local-ai-tts-module-stack', style: { display: 'grid', gap: 16, width: '100%', boxSizing: 'border-box' } },
      h('strong', null, label('Local AI speech', '本地 AI 语音')),
      note(label('Use your existing installation. Folder discovery does not start Python, download models or open a WebUI. Paths refer to the Harness Host, not the browser device.', '使用已有安装。目录识别不会启动 Python、下载模型或打开 WebUI。路径属于运行 Harness 的电脑，不是浏览器所在设备。')),
      engineSelector,
      webui ? note(label(c.webuiMode === 'auto' ? 'Official backend: reuse if available, otherwise start in the background. No browser window is needed. The first connection loads the model and may take a while; keep this page open and do not click repeatedly.' : 'Connection only: reuse the running inference service; never start or stop its model process.', c.webuiMode === 'auto' ? '官方后端：优先复用，否则后台启动，无需打开网页。首次连接会加载模型，可能需要一段时间；请保持页面打开，不要重复点击。' : '仅连接：复用已运行的推理服务，不启动或停止它的模型进程。')) : null,
      field(label(webui && c.webuiMode === 'attach' ? 'Project folder (optional, for finding Python/audio)' : 'Project folder (required)', webui && c.webuiMode === 'attach' ? '项目文件夹（可选，用于查找 Python 和音频）' : '项目文件夹（必填）'), input('projectPath', {
        placeholder: label('Paste the absolute path of your installed engine', '粘贴已安装引擎的文件夹完整路径'), onBlur: scan,
      })),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: detecting || testing || !c.projectPath.trim(), onClick: scan },
        detecting ? label('Finding files…', '正在查找文件…') : label('Find files automatically', '自动查找文件')),
      h('div', { style: { display: 'grid', gap: 6 } },
        gptCharacters.length ? field(label('Character (saved local configuration)', '角色（已保存的本地配置）'), h('select', {
          className: 'dsh-local-ai-tts-select', value: selectedCharacter?.id || '',
          onChange: e => {
            if (!selectCharacter(e.target.value)) return;
            revision.current++; scanRevision.current++; setDetecting(false);
            setStatus(label('Character model pair, reference and transcript filled. Connection is not tested yet.', '已填入角色模型组合、参考音频和原文；尚未测试连接。'));
            render(n => n + 1);
          },
        }, h('option', { value: '' }, label('Choose a character', '请选择角色')),
        ...gptCharacters.map(v => h('option', { key: v.id, value: v.id }, `${v.name} (${v.config.gptVersion})`)))) : null,
        gptCharacters.length ? note(label('Reads local runtime_voices/voice.json metadata, not its tensor cache. Model weights apply on backend startup; connection-only mode cannot switch an existing WebUI model.', '读取本地 runtime_voices/voice.json 配置，不加载其中的张量缓存。模型权重在后台启动时生效；仅连接模式不会切换已有 WebUI 的模型。')) : null,
        characterOptions.length ? field(label('Character voice (saved preset)', '角色音色（已保存预设）'), h('select', {
          className: 'dsh-local-ai-tts-select', value: characterOptions.some(v => v.id === audioValue) ? audioValue : '',
          onChange: e => { if (e.target.value) change('voice', e.target.value); },
        }, h('option', { value: '' }, label('Choose a character', '选择角色音色')),
        ...characterOptions.map(v => h('option', { key: v.id, value: v.id }, audioLabel(v))))) : null,
        characterOptions.length ? note(label('Character entries use the saved voice cache when available; the prompt.wav path is kept only as the official WebUI input.', '角色音色会优先使用已保存的 voice_cache；prompt.wav 路径仅作为官方 WebUI 的输入。')) : null,
        otherAudioOptions.length ? field(label(characterOptions.length || gptCharacters.length ? 'Other detected reference audio' : 'Detected reference audio', characterOptions.length || gptCharacters.length ? '其他检测到的参考音频' : '找到的参考音频'), h('select', {
          className: 'dsh-local-ai-tts-select', value: otherAudioOptions.some(v => v.id === audioValue) ? audioValue : '',
          onChange: e => { if (e.target.value) change('voice', e.target.value); },
        }, h('option', { value: '' }, label('Choose audio / enter a path below', '选择音频／在下方填写路径')),
        ...otherAudioOptions.map(v => h('option', { key: v.id, value: v.id }, audioLabel(v))))) : null,
        field(referenceTitle, input(c.engine === 'gpt-sovits' ? 'referenceAudio' : 'voice', {
          value: audioValue, placeholder: label('Auto-filled when only one audio is found; external paths also work', '只找到一个音频时自动填入；也可填写其他位置的音频'),
        }))),
      field(label('Output language', '合成语言'), h('select', {
        className: 'dsh-local-ai-tts-select', value: languageOptions.some(v => v[0] === languageValue) ? languageValue : languageOptions[0][0],
        onChange: e => change('textLang', e.target.value),
      }, ...languageOptions.map(v => h('option', { key: v[0], value: v[0] }, v[1])))),
      field(label(c.engine === 'indextts' ? 'Duration factor (model setting)' : 'Speech speed (model setting)', c.engine === 'indextts' ? '时长系数（模型原版设置）' : '语速（模型原版设置）'), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' } },
        h('input', { type: 'range', min: speedMin, max: speedMax, step: speedStep, value: speedValue, onChange: e => change(speedKey, Number(e.target.value)) }),
        h('output', { style: { minWidth: 42, textAlign: 'right' } }, speedValue.toFixed(2)))),
      note(label(c.engine === 'indextts' ? '0.50 is faster and 2.00 is slower; this is the official IndexTTS duration_factor.' : '1.00 is the official default; the range matches the GPT-SoVITS WebUI speed_factor control.', c.engine === 'indextts' ? '0.50 更快，2.00 更慢；这里使用 IndexTTS 原版 duration_factor。' : '1.00 是官方默认值；范围与 GPT-SoVITS WebUI 的 speed_factor 一致。')),
      c.engine === 'gpt-sovits' ? note(label('Advanced contains the reference transcript and languages. Depending on the model, its matching transcript may be required; it cannot be inferred from the filename.', '参考音频原文和语言位于高级设置。部分模型需要填写对应原文，无法靠文件名可靠推断。')) : null,
      detected ? h('div', { role: 'status', 'aria-live': 'polite' },
        ...detected.warnings.map(code => warnings[code]).filter(Boolean).map(message => h('p', { key: message, className: 'dsh-local-ai-tts-module-desc' }, message))) : null,
      h('details', null,
        h('summary', { style: { cursor: 'pointer', padding: '10px 0' } }, label('Advanced settings — only if detection needs help', '高级设置 · 自动识别不完整时再填写')),
        h('div', { style: { display: 'grid', gap: 16, paddingTop: 12 } },
          field(label('Connection method', '连接方式'), h('select', { className: 'dsh-local-ai-tts-select', value: c.launchPreset, onChange: e => change('launchPreset', e.target.value) },
            h('option', { value: 'webui' }, label('Official WebUI backend (no browser required)', '官方 WebUI 后端（无需打开网页）')),
            h('option', { value: 'builtin' }, label('Independent worker / official API', '独立 worker／官方 API')),
            c.launchPreset === 'custom' ? h('option', { value: 'custom' }, label('Saved custom worker', '已保存的自定义 worker')) : null)),
          webui ? field(label('Backend startup', '后端启动'), h('select', { className: 'dsh-local-ai-tts-select', value: c.webuiMode, onChange: e => change('webuiMode', e.target.value) },
            h('option', { value: 'auto' }, label('Reuse or start official backend', '复用或后台启动官方后端')),
            h('option', { value: 'attach' }, label('Connect only; never start a model', '仅连接，不启动模型')))) : null,
          webui ? field(label('Inference WebUI address (auto-detected when blank)', '推理 WebUI 地址（留空时读取官方端口配置）'), input('webuiEndpoint', { placeholder: 'http://127.0.0.1:…' })) : null,
          webui ? note(label('Uses the confirmed reference and initial WebUI defaults, not unsaved settings in another browser. The selected endpoint must be the intended engine/model.', '使用已确认的参考音频和网页初始参数，不同步其他浏览器中未保存的设置。请确认该地址运行的是目标引擎和模型。')) : null,
          choice('pythonPath', label('Python executable', 'Python 可执行文件'), label('Blank: python on PATH', '留空：使用 PATH 中的 python')),
          c.engine === 'indextts' ? choice('modelDir', label('IndexTTS 2.5 model directory', 'IndexTTS 2.5 模型目录'), label('Directory containing config.yaml', '包含 config.yaml 的目录')) : null,
          !webui && c.engine === 'indextts' ? field(label('Additional voice directory (optional)', '附加音色目录（可选）'), input('presetsRoot')) : null,
          !webui && c.engine === 'indextts' ? field(label('Device (optional)', '设备（可选）'), input('device', { placeholder: 'cuda:0 / cpu' })) : null,
          !webui && c.engine === 'gpt-sovits' ? field(label('API script', 'API 启动脚本'), input('apiScript', { placeholder: 'api_v2.py' })) : null,
          !webui && c.engine === 'gpt-sovits' ? field(label('Inference YAML', '推理配置 YAML'), input('ttsConfig', { placeholder: 'GPT_SoVITS/configs/tts_infer.yaml' })) : null,
          webui && c.engine === 'gpt-sovits' ? field(label('Official inference variant (startup only)', '官方推理分支（仅启动时使用）'), h('select', { className: 'dsh-local-ai-tts-select', value: c.webuiVariant, onChange: e => change('webuiVariant', e.target.value) }, h('option', { value: 'standard' }, 'standard'), h('option', { value: 'fast' }, 'fast'))) : null,
          webui && c.engine === 'gpt-sovits' ? choice('gptVersion', label('Saved GPT model version (startup only)', '已保存的 GPT 模型版本（仅启动时使用）'), 'v1 / v2 / v3 / v4 / v2Pro / v2ProPlus') : null,
          webui && c.engine === 'gpt-sovits' ? field(label('GPT weights override (optional)', 'GPT 权重覆盖（可选）'), input('gptModel')) : null,
          webui && c.engine === 'gpt-sovits' ? field(label('SoVITS weights override (optional)', 'SoVITS 权重覆盖（可选）'), input('sovitsModel')) : null,
          c.engine === 'gpt-sovits' ? field(label('Reference transcript (model-dependent)', '参考音频原文（是否必填取决于模型）'), input('promptText')) : null,
          c.engine === 'gpt-sovits' ? field(label('Reference language', '参考音频语言'), input('promptLang', { placeholder: 'zh / en / ja' })) : null,
          !webui && c.engine === 'gpt-sovits' ? field(label('API port', 'API 端口'), input('port', { type: 'number', min: 1024, max: 65535, onChange: e => change('port', Number(e.target.value)) })) : null,
          c.launchPreset === 'custom' || c.endpoint ? note(label('Saved custom/legacy configuration. Changing the project folder selects the official backend.', '当前保留了旧版或自定义配置。更换项目文件夹后将选择官方后端。')) : null,
          field(label('Startup timeout (ms)', '启动超时（毫秒）'), input('startupTimeoutMs', { type: 'number', min: 1000, max: 600000, onChange: e => change('startupTimeoutMs', Number(e.target.value)) })),
          field(label('Request timeout (ms)', '请求超时（毫秒）'), input('timeoutMs', { type: 'number', min: 100, max: 600000, onChange: e => change('timeoutMs', Number(e.target.value)) })),
          !webui ? h('label', null, h('input', { type: 'checkbox', checked: c.autoStart !== false, onChange: e => change('autoStart', e.target.checked) }), label('Start worker automatically when reading', '朗读时自动启动 worker')) : null,
          h('label', null, h('input', { type: 'checkbox', checked: c.debug, onChange: e => change('debug', e.target.checked) }), label('Debug: logs full sentence text (private data)', 'Debug：将完整句子写入日志（含隐私数据）')))),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', disabled: testing || detecting, onClick: async () => {
        const current = revision.current, key = JSON.stringify(c), provider = shared.provider;
        const valid = () => current === revision.current && shared.localProcess === c && JSON.stringify(c) === key && shared.provider === provider;
        setTesting(true); setStatus(label(webui && c.webuiMode === 'attach' ? 'Connecting to inference service…' : 'Connecting / loading engine in the background…', webui && c.webuiMode === 'attach' ? '正在连接推理服务…' : '正在后台连接／加载引擎…'));
        try {
          const d = await rpc('status', { config: { ...snapshot().config } });
          if (!valid()) return;
          setVoices(d.voices || []);
          setStatus((d.ready ? label('● Worker responded', '● Worker 已响应') : label('Worker not ready: ', 'Worker 尚未就绪：') + d.status) +
            (d.warning ? ' — ' + d.warning : '') + label(' — synthesis still needs a trial read.', ' — 实际合成仍需试听验证。'));
        } catch (e) { if (valid()) setStatus(e.message); }
        finally { setTesting(false); }
      } }, testing ? label('Connecting…', '连接中…') : label('Test Connection', '测试连接')),
      h('div', { role: 'status', 'aria-live': 'polite', style: { overflowWrap: 'anywhere' } }, status || label('Not tested', '尚未测试')),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: () => { saveSettings(); setStatus(label('Settings saved', '设置已保存')); } }, label('Save settings', '保存设置')));
  }
  function Player() {
    useSharedForce();
    if (!isProcessProvider(shared.provider) || !shared.speaking) return null;
    const h = react.createElement;
    const zh = window.__dshLocalAiTtsI18n?.current() !== 'en';
    return h('div', { className: 'dsh-local-ai-tts-module', role: 'region', 'aria-label': zh ? '本地语音播放器' : 'Local Runtime player',
      style: { position: 'fixed', bottom: 24, right: 24, zIndex: 1000, display: 'flex', gap: 12, alignItems: 'center', padding: 12,
        background: 'var(--dsw-alias-bg-layer-2, #20242c)', color: 'var(--dsw-alias-label-primary, #fff)', borderRadius: 12 } },
      h('span', { role: 'status' }, (zh ? '本地语音 · ' : 'Local TTS · ') + (shared.chunkProgress?.index || '…')),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: togglePause }, shared.paused ? t('mini.resume') : t('mini.pause')),
      h('button', { type: 'button', className: 'dsh-local-ai-tts-browse', onClick: stopSpeaking }, t('stopRead')));
  }
  slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', key: 'local-runtime-player', id: 'local-runtime-player', order: 1003 }, Player));
  ctx.effect(() => { const timer = setInterval(poll, 200); sync(); return () => { clearInterval(timer); stop(); }; }, 'local-runtime: browser player');
  return { defaults, sync, stop, session, read, Settings, discover, updateSetting, selectEngine, selectCharacter, applyHttpPreset };
}
