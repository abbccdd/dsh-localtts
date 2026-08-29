# Changelog

## 0.1.8 — 2026-08-29

- Shorten only an unusually long opening segment of manual/history reads so the first audio can play while later text is synthesized.
- Keep streamed Auto Read sentence boundaries unchanged.
- Begin loading a valid owned process backend in the background when Auto Read is enabled, instead of waiting for the first history click or reply.

## 0.1.7 — 2026-08-29

- Remember separate IndexTTS and GPT-SoVITS project/model/voice settings and restore them when switching engines.
- Persist both engine profiles across browser refreshes without carrying one engine's paths into the other.

## 0.1.6 — 2026-08-29

- Keep an owned official WebUI model warm while its browser client remains active; stale clients and DSH shutdown still release the worker.
- Raise the effective automatic GPT-SoVITS WebUI cold-start allowance to five minutes for older saved settings.
- Detect implausibly long GPT-SoVITS single-sentence WAVs and retry once through the official sampling controls, while rejecting near-empty retries.

## 0.1.5 — 2026-08-29

- Make the plugin's automatic UI language follow the active DSH locale before the browser locale, while keeping explicit Chinese/English overrides.
- Remove Chinese em dashes, box-drawing separators and Markdown horizontal rules from speech input in both browser and Host Runtime paths.

## 0.1.4 — 2026-08-29

- Bootstrap bundled adapter imports explicitly for Windows embedded Python / isolated module paths; do not edit the engine's `pythonXY._pth`.
- Support the existing Gradio client 0.14.x file/constructor/cleanup interfaces, with loopback-only requests, disabled proxies, redirects and telemetry, and no automatic output downloads.
- Handle Python 3.9's separate socket timeout exception when probing an unused WebUI port.
- Verify both installed Gradio 4.24 and Gradio 5 protocol fixtures without loading model weights; actual model readiness remains a separate check.

## 0.1.3 — 2026-08-29

- Discover GPT-SoVITS references under `runtime_voices` and validated local `voice.json` v1 character configurations; do not load tensor caches or guess checkpoint pairs.
- Select a saved GPT character to apply its model pair, version, reference audio, transcript and language together. Preserve manual overrides on rescan and reject stale selections after changing projects.
- Explain incomplete `weight.json` selections separately from missing reference files. Character metadata support is a local-runtime compatibility feature, not an official universal preset format.

## 0.1.2 — 2026-08-28

- Added model-native output language selection and synthesis speed controls. IndexTTS uses `duration_factor`; GPT-SoVITS uses the matching `speed` / `speed_factor` field exposed by the detected official API.
- Added an explicit first-connection loading message and completed the control wiring through WebUI and built-in workers.

## 0.1.1 — 2026-08-28

- Added a dedicated IndexTTS character preset selector. Saved roles such as `雷米埃尔` and `甘雨` are shown by name, while the official prompt path remains an internal WebUI input.
- Clearly separated saved character voices from ordinary example/reference audio in the settings panel.

## 0.1.0 — 2026-08-28

Initial Local AI TTS release candidate, derived from dsh-plugin-tts 0.3.0 (not an upstream version rollback).

- Added process providers for IndexTTS 2.5 and GPT-SoVITS. The plugin starts a configured worker without changing model code or opening WebUI.
- Added verified IndexTTS 2.5 voice-cache reuse before official WebUI/worker reference decoding, including Gradio temporary-file copies.
- Added a shell-free JSONL worker protocol with configurable executable, working directory, arguments, engine, voice and startup/request timeouts.
- Added worker lifecycle health checks, optional voice discovery, cancellation, cleanup and safe error reporting.
- Simplified local setup to engine, project folder and reference audio, with optional paths/parameters under collapsed Advanced settings.
- Added bounded, read-only directory discovery for IndexTTS 2.5 and GPT-SoVITS, explicit candidate selection, manual-override preservation, and stale-response protection. Python/model files are detected, not installed.
- Fixed engine/provider persistence and reference-audio selection; incomplete new settings disable the previous Host Auto Read snapshot.
- Updated bilingual setup instructions and documented official launch sources and discovery boundaries; legacy HTTP configuration remains a compatibility path.
- Documented Edge Read Aloud's hosted-service caveat, Azure Speech character billing and the separate Limited Access/consent requirements for custom voices.
- Added strict sentence buffering, asynchronous synthesis/playback, three-segment prefetch, per-browser queues, cancellation and event sequence deduplication.
- Reused upstream Edge/RVC controls and settings; added streaming playback controls while a message is still being generated.
- Added original-plugin coexistence: independent routes/storage/styles/UI identifiers, public-inventory detection, Local companion mode and original Auto Read guard. Original code/settings are not modified.
- Added unmodified upstream fixtures to test both load orders, independent disposal, late detection and migration/reset isolation. Real Harness coexistence still needs acceptance.
- Added optional HTTP facade for existing Python Runtime objects; no model imports, loaders or inference overrides.
- Added GPU-free mock tests, bilingual documentation, attribution and release file checks.
- Real Harness + IndexTTS and Harness + GPT-SoVITS smoke acceptance remains a release gate; see docs/VALIDATION.md.
