// Embedded by build-client.mjs. All names and state belong to this fork.
const coexistence = { upstream: false, companion: false, upstreamAutoRead: null };
const UPSTREAM_TTS_PACKAGE = '@dsh-external/dsh-plugin-tts';
function detectUpstreamTts() {
  try {
    const loader = ctx.get('loader');
    if (typeof loader?.entries === 'function') {
      return Array.from(loader.entries()).some(e => e.options?.name === UPSTREAM_TTS_PACKAGE &&
        e.disabled !== true && e.options?.disabled !== true);
    }
  } catch {}
  const graph = window.__DSH_BOOT__;
  if (Array.isArray(graph?.entries)) return graph.entries.some(e => e.id === UPSTREAM_TTS_PACKAGE);
  // Older Harness versions may expose neither inventory nor boot metadata.
  // Upstream itself exports this settings getter. Read it; never replace it.
  return typeof window.__dshTtsSettings?.get === 'function';
}
function upstreamAutoRead() {
  try {
    const value = window.__dshTtsSettings?.get?.().autoRead;
    return typeof value === 'boolean' ? value : null;
  } catch { return null; }
}
function localAutoAllowed() {
  return !coexistence.companion || (coexistence.upstream && upstreamAutoRead() === false);
}
function refreshCoexistence() {
  const upstream = detectUpstreamTts();
  const companion = upstream || shared.coexistenceMode === 'companion';
  const auto = upstream ? upstreamAutoRead() : null;
  const changed = companion !== coexistence.companion || upstream !== coexistence.upstream || auto !== coexistence.upstreamAutoRead;
  Object.assign(coexistence, { upstream, companion, upstreamAutoRead: auto });
  if (companion && shared.provider !== 'local-runtime' && shared.provider !== 'indextts-process' && shared.provider !== 'gpt-sovits-process') {
    stopSpeaking(); shared.provider = shared.localProcess?.command ? 'indextts-process' : 'local-runtime';
  }
  if (companion && auto !== false && shared.speakSource === 'auto') stopSpeaking();
  if (companion) shared.hideSelectionRead?.();
  if (changed) { localRuntime.sync(); notify(); }
}
function CoexistenceNotice() {
  useSharedForce(); useI18n();
  const h = react.createElement;
  return h('section', { className: 'dsh-local-ai-tts-module dsh-local-ai-tts-module-stack', 'aria-label': t("coexist.title") },
    h('strong', null, t("coexist.title")),
    h('p', { role: 'status', className: 'dsh-local-ai-tts-module-desc' }, coexistence.companion ? t("coexist.companion") : t("coexist.standalone")),
    coexistence.companion && !localAutoAllowed() ? h('p', { role: 'status' }, t("coexist.autoBlocked")) : null,
    h('label', null, t("coexist.mode"), h('select', {
      className: 'dsh-local-ai-tts-select', value: shared.coexistenceMode,
      onChange: e => { shared.coexistenceMode = e.target.value; refreshCoexistence(); saveSettings(); notify(); },
    }, h('option', { value: 'auto' }, t("coexist.auto")), h('option', { value: 'companion' }, t("coexist.force")))));
}
