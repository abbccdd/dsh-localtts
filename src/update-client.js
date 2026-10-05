// The market owns package replacement, validation and rollback. This client
// only checks this repository's releases and requests an explicit update.
const LOCAL_PLUGIN_VERSION = "__LOCAL_PLUGIN_VERSION__";
const LOCAL_PLUGIN_PACKAGE = '@dsh-external/dsh-plugin-local-ai-tts';
const LOCAL_PLUGIN_REPO = 'abbccdd/dsh-localtts';
const LOCAL_PLUGIN_UPDATE_KEY = 'dsh-local-ai-tts-update-v1';
function releaseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}
function compareReleaseVersions(a, b) {
  const left = releaseVersion(a), right = releaseVersion(b);
  if (!left || !right) throw new Error('Invalid plugin release version.');
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
function selectPluginRelease(releases) {
  if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response.');
  let latest = null;
  for (const release of releases) {
    if (!release || release.draft || !releaseVersion(release.tag_name)) continue;
    const version = release.tag_name.replace(/^v/, '');
    const filename = `dsh-external-dsh-plugin-local-ai-tts-${version}.tgz`;
    const archive = `https://github.com/${LOCAL_PLUGIN_REPO}/releases/download/${release.tag_name}/${filename}`;
    if (!Array.isArray(release.assets) || !release.assets.some(asset => asset.name === filename && asset.browser_download_url === archive)) continue;
    if (!latest || compareReleaseVersions(version, latest.version) > 0)
      latest = { version, candidate: !!release.prerelease, url: `https://github.com/${LOCAL_PLUGIN_REPO}/releases/tag/${release.tag_name}` };
  }
  if (!latest) throw new Error('No complete plugin release is available.');
  return latest;
}
function createPluginUpdater({ request = fetch, storage = localStorage, current = LOCAL_PLUGIN_VERSION, changed = notify, now = Date.now } = {}) {
  const state = { current, latest: null, checking: false, installing: false, installed: false, error: null, auto: true };
  let checkedAt = 0, checking;
  try {
    const saved = JSON.parse(storage.getItem(LOCAL_PLUGIN_UPDATE_KEY) || 'null');
    if (saved) {
      state.auto = saved.auto !== false;
      if (saved.latest && releaseVersion(saved.latest.version) && Number.isFinite(saved.at) && saved.at <= now()) {
        state.latest = { version: saved.latest.version, candidate: !!saved.latest.candidate };
        checkedAt = saved.at;
      }
    }
  } catch { /* browser storage can be unavailable */ }
  function save() {
    try { storage.setItem(LOCAL_PLUGIN_UPDATE_KEY, JSON.stringify({ auto: state.auto, at: checkedAt, latest: state.latest })); } catch { /* browser storage can be unavailable */ }
  }
  async function json(url, options = {}) {
    const response = await request(url, { ...options, credentials: url.startsWith('https:') ? 'omit' : 'same-origin', signal: AbortSignal.timeout(options.method === 'POST' ? 600000 : 15000) });
    if (response.status === 404 && url.startsWith('/dsh-market/')) throw new Error(t("update.marketMissing"));
    const data = await response.json();
    if (!response.ok || data?.error) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    return data;
  }
  function check(force = false) {
    if (checking) return checking;
    if (!force && checkedAt && now() - checkedAt < 86400000) return Promise.resolve(state.latest);
    state.checking = true; state.error = null; changed();
    checking = (async () => {
      try {
        state.latest = selectPluginRelease(await json(`https://api.github.com/repos/${LOCAL_PLUGIN_REPO}/releases?per_page=30`));
        checkedAt = now(); save(); return state.latest;
      } catch (error) { state.error = error.message; return null; }
      finally { state.checking = false; checking = null; changed(); }
    })();
    return checking;
  }
  async function install(confirm) {
    if (state.installing || state.installed) return false;
    state.installing = true; state.error = null; changed();
    try {
      const release = await check(true);
      if (!release) return false;
      if (compareReleaseVersions(release.version, current) <= 0) return false;
      if (!confirm(release)) return false;
      // Refresh the installed source before choosing the market operation.
      const updates = await json('/dsh-market/updates?force=1');
      const source = updates.updates?.[LOCAL_PLUGIN_PACKAGE];
      if (!source || !['github', 'linked'].includes(source.kind)) throw new Error(t("update.sourceHelp"));
      if (source.kind === 'github' && releaseVersion(source.version) && compareReleaseVersions(source.version, release.version) >= 0 && source.updateAvailable === false) {
        state.installed = true; return true;
      }
      const result = await json('/dsh-market/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: LOCAL_PLUGIN_PACKAGE, force: true, ...(source.kind === 'linked' ? { restore: true } : {}) }),
      });
      if (result.ok !== true || result.cancelled || result.stale || result.timedOut || result.compatibility?.ok === false)
        throw new Error(result.error || t("update.failed"));
      // The old module stays loaded until Harness restarts.
      state.installed = true; return true;
    } catch (error) { state.error = error.message; return false; }
    finally { state.installing = false; changed(); }
  }
  return { state, check, install, available: () => state.latest && compareReleaseVersions(state.latest.version, current) > 0,
    setAuto(value) { state.auto = !!value; save(); changed(); } };
}
const pluginUpdater = createPluginUpdater();
function PluginUpdatePanel() {
  useSharedForce(); useI18n();
  const state = pluginUpdater.state;
  react.useEffect(() => { if (state.auto) void pluginUpdater.check(); }, [state.auto]);
  const busy = state.checking || state.installing;
  return react.createElement('section', { className: 'dsh-local-ai-tts-module', style: { display: 'block' } },
    react.createElement('div', { className: 'dsh-local-ai-tts-module-title' }, t("update.title") + ' · v' + state.current),
    react.createElement('p', { className: 'dsh-local-ai-tts-module-desc', role: 'status' },
      state.installed ? t("update.restart") : busy ? t("update.busy") : state.latest ?
        (pluginUpdater.available() ? t("update.available") : t("update.current")) + ' v' + state.latest.version + (state.latest.candidate ? ' · ' + t("update.candidate") : '') : t("update.help")),
    react.createElement('label', { className: 'dsh-local-ai-tts-check' },
      react.createElement('input', { type: 'checkbox', checked: state.auto, onChange: e => pluginUpdater.setAuto(e.target.checked) }), t("update.auto")),
    react.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
      react.createElement('button', { type: 'button', className: 'dsh-local-ai-tts-btn', disabled: busy, onClick: () => void pluginUpdater.check(true) }, t("update.check")),
      react.createElement('button', { type: 'button', className: 'dsh-local-ai-tts-btn', disabled: busy || state.installed || !pluginUpdater.available(),
        onClick: () => void pluginUpdater.install(release => window.confirm(t("update.confirm") + ' v' + release.version + (release.candidate ? ' · ' + t("update.candidate") : ''))) }, t("update.install")),
      react.createElement('a', { href: 'https://github.com/abbccdd/dsh-localtts/releases', target: '_blank', rel: 'noopener noreferrer' }, t("update.releases"))),
    state.error && react.createElement('p', { role: 'alert' }, state.error),
    react.createElement('details', null, react.createElement('summary', null, t("update.manual")),
      react.createElement('p', { className: 'dsh-local-ai-tts-module-desc' }, t("update.sourceHelp")),
      react.createElement('code', { style: { overflowWrap: 'anywhere' } }, 'dsh plugin --profile web add github:abbccdd/dsh-localtts')));
}
