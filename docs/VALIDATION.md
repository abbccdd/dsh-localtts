# Validation and release gate — 0.1.5

## Automated coverage

Run `npm test` and `npm run test:adapter`. Tests require no GPU, downloaded model, cloud API, login credential or newly installed production dependency.

- Configuration validation, localhost defaults, custom ports/base paths, private LAN consent, public URL/credentials/query rejection.
- IndexTTS and GPT-SoVITS process worker contracts, JSONL health/voices/synthesis, worker startup and cleanup; legacy HTTP adapters remain covered for compatibility.
- Offline service, full-response timeout, HTTP cancellation, redirects, malformed payloads, error redaction, explicit debug logging.
- Three Chinese/English sentences → exactly three Runtime requests; short sentences never merge; 55/70-character limits; streamed decimal/tail handling; visual dash separators are removed before synthesis.
- Nonblocking event ingestion, duplicate `seq`, final-message deduplication, repeated React session snapshots, session separation.
- Failure recovery, cancellation and turn suppression, switching engine/voice, bounded prefetch, pause backpressure, client expiry.
- Browser controller schedules three consecutive Web Audio buffers and acknowledges them after completion (mock AudioContext).
- Existing UI bundle load/render, bilingual keys and settings persistence; simplified engine/project/reference controls, output-language selector, model speed control and collapsed advanced paths.
- Bounded read-only IndexTTS/GPT-SoVITS discovery, wrapper/Unicode layouts, missing or ambiguous candidates, incompatible Index config version, directory-link escape and audio count/depth limits; same-origin route validation with no client/worker creation.
- Discovery request deduplication, preservation of manual overrides, late-response rejection, engine/provider synchronization, GPT reference synchronization and disabling stale Host Auto Read during incomplete configuration.
- Unmodified upstream 0.3.0 Host/client fixtures loaded in both orders: no route/slot/style collisions, no original settings/global changes, and independent disposal.
- Public inventory detection, missing inventory fallback, enable/disable, forced companion mode, one-time migration/reload/reset, Auto Read state guard and manual playback preservation.
- Optional stdlib Python HTTP facade exercised with mock existing objects for both engines. No actual model object is created.
- Official backend launch guards: source-only entry inspection, IndexTTS/GPT API-shape selection, Gradio 4/5 metadata and loopback checks, explicit saved GPT weight selection, occupied-port refusal in auto mode, and owned-process EOF cleanup.
- Generated client consistency, package identity, original LICENSE preservation and release artifact scan.

Preparation results: 64 Node tests (including discovery, settings, process-worker, coexistence and runtime-pool tests), 55 client-load checks, 6 i18n checks, and 11 Python adapter tests passed on Windows, Node 24.13.1 / Python 3.11.9. The Gradio 4/5 official-shape fixture smoke also passed. This is not a claim that GitHub Actions has already run remotely.

The static UI fixture was opened in a real browser and inspected after this change. Both engines show project/reference fields and correctly selected providers; advanced paths are hidden by default and the native details control expands. The fixture uses the upstream lightweight DOM renderer, not a running Harness/React application, so it is visual QA only; discovery/editing behavior is covered separately by controller tests. Run `node tools/gen-ui-preview.mjs` then `node tools/preview-server.mjs` to reproduce; generated HTML/screenshots are excluded from Git.

Read-only discovery was also run against the existing local IndexTTS wrapper on 2026-08-28. It resolved `app`, its `.venv` Python, `checkpoints` and 14 audio candidates, including example voices and a nested preset reference. It deliberately did not auto-select a voice among multiple candidates. This check did not launch Python, read audio/weights or establish GPT-SoVITS availability. GPT integrated-package discovery was tested with filesystem fixtures only.

## Real local acceptance — PARTIALLY COMPLETE

During preparation, installed Harness event types and both existing Python Runtime method signatures were inspected read-only. The existing GPT-SoVITS HTTP bridge contract was inspected read-only. No Runtime implementation or inference parameter was changed.

The IndexTTS 2.5 installation and a usable local worker were confirmed on 2026-08-28. The direct worker smoke passed on CPU, and the real GPU regression passed (`1 passed, 16 deselected`) with the existing `雷米埃尔` cache. No model code, weights or inference settings were changed. A local headless WebUI process also exposed its real Gradio 5 schema and generated a valid WAV from `examples/voice_01.wav`; this was a test of the current local `app/webui.py`, not proof of an unmodified upstream checkout. A running Harness web endpoint, browser playback session, and a real GPT-SoVITS installation with weights are still not confirmed. The requested full end-to-end acceptance below has therefore **not passed**, and the project remains a release candidate. Fixture audio must not be reported as real generated speech.

### Local role and WebUI checks outside DSH — PARTIAL

The existing IndexTTS preset registry recognized `甘雨` and `雷米埃尔`; both caches contained the required tensors. Loading each cache with `IndexTTSRuntime` and synthesizing `你好，这是本地角色音色测试。` produced nonempty mono 22050 Hz WAV files with nonzero RMS: `outputs/verification/甘雨-verification.wav` (3.506 s, 142380 bytes) and `outputs/verification/雷米埃尔-verification.wav` (3.228 s, 154668 bytes).

The local WebUI started headlessly on loopback, returned Gradio `5.45.0 / sse_v3` metadata, and `/gen_single` produced a valid 22050 Hz WAV (177708 bytes, 4.03 s) when given the real RIFF `examples/voice_01.wav` reference. Both saved preset files named `prompt.wav` are actually MP4/ISO files (`ftypisom` and `ftypiso4` headers). The unmodified path fails on those files, while the plugin's new launch hook matched their SHA-256 fingerprints, loaded the existing voice caches, and generated a valid WAV through the official inference path. The original files were not altered. The GPT-SoVITS tree currently present under restore staging contains source files but no model weights or usable environment, so it was not a real synthesis test.

Earlier direct health probes to the documented example endpoints (IndexTTS port 8765 and GPT-SoVITS port 9881) both returned `OFFLINE / ECONNREFUSED`; those probe ports are not assumed to be the user's actual deployment ports. This is separate from the later direct IndexTTS process-worker smoke below.

### Direct IndexTTS 2.5 process-worker smoke — PASSED

Using the existing installation's Python environment, `app/checkpoints`, and the repository's example `voice_01.wav`, the plugin's `ProcessTTSProvider` started `adapters/index-tts-worker.py`, imported `indextts.infer_v2_5.IndexTTS2`, passed `health` and `voices`, then synthesized these three sentences independently:

| Request | Result |
| --- | --- |
| 1 | WAV, 121388 bytes, 22620 ms |
| 2 | WAV, 124972 bytes, 16750 ms |
| 3 | WAV, 119340 bytes, 16792 ms |

All responses had a valid RIFF/WAVE header. Total synthesis time was about 56 seconds on CPU. The worker's temporary output files were removed and the child process was disposed after the run. This proves the local process/adapter/model boundary only; it does not prove Harness event ingestion, sentence streaming timing, browser Web Audio playback, pause/resume, or audible quality.

| Required acceptance | Result |
| --- | --- |
| Direct IndexTTS worker: three requests and valid audio | **Passed 2026-08-28 on CPU**; see the smoke record above |
| Real Harness answer → IndexTTS: three requests and continuous browser speech | Pending: running Harness + configured IndexTTS worker required |
| Real Harness answer → GPT-SoVITS: three requests and continuous browser speech | Pending: running Harness + configured GPT-SoVITS worker required |
| Real browser audible quality / pause / resume / stop | Pending on target Harness instance |
| Both plugins enabled in actual Harness; original Edge/RVC preserved and local Auto Read ownership verified | Pending; both load orders tested only with captured original bundles and mocked Harness/browser APIs |
| Node 22/24 GitHub Actions matrix | Workflow prepared; remote CI has not been run here |

The tool `npm run smoke:runtime -- --engine … --endpoint … --voice …` performs three real HTTP syntheses without saving audio. Even a successful command does not replace browser listening acceptance.

## Exact real acceptance procedure

1. Prepare the two **existing** model installations. Supply each project folder, run automatic discovery and select its reference audio; use Advanced only for missing/ambiguous paths or GPT reference transcript/languages. Do not change model code/weights/inference parameters for this test.
2. Install this checkout into the existing web profile, restart Harness and refresh the browser. The original TTS plugin may remain installed/enabled. With both enabled, confirm distinct original and **Local voice** tabs; turn OFF original Auto Read before enabling Local Auto Read. Also test the reverse installation order and independent disable/re-enable as described in [COEXISTENCE](COEXISTENCE.md).
3. Select IndexTTS 2.5 (local), discover the project/reference and Test Connection. Confirm the worker responds, then try a short preview. Click the page once to unlock audio.
4. Enable Auto Read and ask Harness: “请只回答三句：第一句，这是本地测试。第二句，正在逐句播放。第三句，测试结束。”
5. Observe exactly three successful local synthesis log records (request ID, chars, duration, status; Debug OFF). Listen for order/continuity, and verify sentence 1 can start before the full answer is complete. Record whether the worker is slower than real time.
6. Repeat with a new reply, pause/resume, stop mid-reply, then manually read a message. Check stop does not play stale audio. Refresh and verify config persisted but old replies do not replay.
7. Switch to GPT-SoVITS (local), discover its project/reference, set the required transcript/languages in Advanced and repeat steps 3–6. Check no old engine/voice audio remains.
8. Temporarily break the worker command, verify a clear spawn/import/timeout failure, then fix it and manually retry. Do not let tests silently use Edge.

Record date, Harness version, engine/bridge version, browser, protocol, request count, playback ordering/continuity and remaining issues. Keep personal endpoints, voice IDs, logs, audio and screenshots in an ignored local artifact directory; publish only anonymized results.

## Before publishing

- [ ] Complete both real end-to-end rows above and inspect the actual UI in the target Harness version.
- [x] Confirm repository owner/name: `abbccdd/dsh-localtts`; the source install example uses the `main` branch until a release tag is created.
- [ ] Confirm the existing Runtime HTTP contracts and its operator's model/voice usage rights.
- [ ] Inspect `git diff`, `git status`, and `npm pack --dry-run`; verify no private files were force-added.
- [ ] Review upstream inherited Edge/RVC security assumptions. Do not expose their trusted-local management routes to untrusted users.
- [ ] Run CI on Node 22 and 24, then tag/release. This upload contains source only; models, audio and caches remain excluded.

Upstream RVC developer guides/tests remain for provenance; their historical real-machine results are **not validation of this fork**. The new README and this file govern Local Runtime release readiness.
