# DeepSeek Harness Local AI TTS Plugin

[简体中文](README.zh-CN.md) · Version **0.1.4 release candidate** · MIT

Read DeepSeek Harness assistant replies with **IndexTTS 2.5** or **GPT-SoVITS** started by the plugin. The user supplies the existing Python/project/model configuration; the plugin starts a thin JSONL worker and sends one natural sentence per request. No WebUI page is required.

Based on [1624318455/dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts), commit `ec0cf87ef52abb81ae91681a966aa3096365e631`. Its message buttons, Auto Read toggle, Edge/RVC providers, pause/stop controls, settings and Harness API integration are reused. See [NOTICE](NOTICE.md).

**This is a connector and process launcher, not a model distribution.** It does not install, trim, retrain or modify TTS models. It only starts the executable and worker command that you configure. No checkpoints, reference recordings, voice caches, Python environments or generated audio are included.

```text
Harness assistant events → SentenceBuffer → local process provider
                                               ↓ JSONL stdin/stdout
                                    IndexTTS / GPT-SoVITS adapter
                                               ↓ audio / PCM
                                        Browser Web Audio
```

## Requirements and support

- DeepSeek Harness web profile with `webServer`, `session/event` and client UI slots. Node.js 22+ and a browser with Web Audio.
- An existing IndexTTS 2.5 or GPT-SoVITS installation, its Python environment and model files.
- A worker command implementing the [JSONL worker protocol](docs/PROCESS-WORKER-PROTOCOL.md). Thin examples are included in `adapters/`; they import/start the user's existing model project and do not contain weights.

The plugin discovers known paths only inside the selected local project/wrapper folder. It does not scan whole disks, install dependencies or open WebUI pages. Detected and manually configured paths are kept in browser settings.

## Install

**This plugin can be installed and enabled alongside the original.** Its package, routes, settings and UI identifiers are independent. Detection of the original automatically enables Local companion mode; see below.

```sh
dsh plugin --profile web add "github:abbccdd/dsh-localtts#main"
```

The above is a publication template, not an existing hosted release. To install the prepared local checkout now, replace the example checkout path with your own:

```sh
dsh plugin --profile web add "file:/path/to/dsh-plugin-local-ai-tts"
dsh web
```

Restart `dsh web` and refresh its browser page after installation. On Windows a `file:` installation may be a copy; reinstall the local package after changing it. Do not edit Harness core files.

## Coexistence with the original plugin

Without the original, this plugin offers Edge TTS, RVC, IndexTTS 2.5 (local) and GPT-SoVITS (local). When the original is detected, this plugin offers the local process providers only, leaving Edge/RVC, selection reading, generic shortcuts and approval alerts to the original. Its settings tab is **Local voice**, its message button is marked **Local**, and its toggle is **Local Auto Read**.

Turn **off the original Auto Read before enabling Local Auto Read**. Local automatic speech is suspended while the original Auto Read is on or unknown. State changes cancel local automatic queues, but do not interrupt manual local reads. This is a polling guard, not an atomic lock across both players: do not start two manual readers together. This plugin cannot stop audio already playing in the original.

The original has no public third-party Provider registration interface, so Local Runtime appears in a separate settings tab rather than being injected into the original dropdown. Neither the original code nor its settings are modified. An optional **Always provide local features only** setting handles older Harness versions or other forks; unknown original state keeps local automatic reading suspended.

Settings, language and voice-pack state are isolated. A one-time, read-only copy of old TTS settings disables imported Auto Read and approval alerts. Saving/resetting/uninstalling this plugin does not change original settings. Restart Harness and refresh after changing plugin activation; older versions without inventory metadata need a refresh to clear a stale original settings getter. [Coexistence details and test boundaries](docs/COEXISTENCE.md).

## Configure a local process (IndexTTS 2.5 or GPT-SoVITS)

Open **Settings → Plugins → Voice · Local AI TTS**. A standard installation needs only three main fields:

1. **Engine**: IndexTTS 2.5 or GPT-SoVITS.
2. **Project folder**: paste the existing installation's absolute path. Leaving the field automatically discovers files; **Find files automatically** rescans. Common wrapper directories are supported.
3. **Reference audio**: one candidate is filled automatically; multiple candidates require a choice. An external audio path can also be entered manually.

The main panel also provides **Output language** and the selected model's own **speed control**. The first connection can take a while while the official model loads; keep the settings page open and avoid repeated clicks.

No per-weight paths, launch arguments or JSON editing are needed. Changes save automatically; **Save settings** also saves explicitly.

**Advanced settings are collapsed by default.** Expand them only for missing/ambiguous detection, an external Python/Conda environment or custom model paths. GPT-SoVITS reference transcripts and language settings are also here: some model versions require matching text, which cannot reliably be inferred from a filename. Arbitrary checkpoint files are never guessed.

Paths belong to the **Harness Host**, not the browser device. Discovery checks a bounded set of local files without starting Python, installing dependencies or downloading models. **Test Connection** actually starts the worker. A worker response is not proof of successful synthesis: try a short preview as well.

Rescanning the same project preserves manual overrides. Changing the engine or project clears stale launch paths, reference audio and transcript. Missing files are reported without cloud fallback.

See [directory discovery and required files](docs/ENGINE-DISCOVERY.md) for the rules and official launch sources; [PROCESS-WORKER-PROTOCOL.md](docs/PROCESS-WORKER-PROTOCOL.md) documents custom workers.

### Legacy HTTP compatibility

Previously saved HTTP configurations remain supported internally. They are not the normal setup flow and do not start the external HTTP service. Its API base URL is not a project folder or WebUI URL; see the exact [legacy HTTP contract](docs/LOCAL-RUNTIME-PROTOCOL.md). Changing the project folder returns to the built-in process launcher.

## Read, Auto Read, pause and stop

1. Test the connection, then use the existing preview or assistant-message read button. Interact with the page once so the browser permits audio playback.
2. Turn **Auto Read ON** in the composer. In companion mode, first turn OFF original Auto Read, then enable **Local Auto Read**. Only new assistant text in the active session is read; old messages are not replayed on page refresh.
3. Each completed sentence is queued immediately. While Harness produces sentence 3, the Runtime can synthesize sentence 2 and the browser play sentence 1.
4. The Local Runtime player stays available during streaming. **Pause/Resume** controls audio; **Stop** cancels pending work and suppresses the remaining automatic turn. Turning Auto Read OFF stops automatic reading but preserves a manual read.
5. Changing engine/voice/endpoint stops old work. Repeated React renders, finalized messages and repeated event sequence numbers do not replay the same stream.

Local Runtime uses a 55-character soft target and 70-character hard limit. Three short sentences always cause three requests. It never merges short sentences. Synthesis slower than speech can cause gaps. The settings panel exposes output language and the model's own speed control: IndexTTS uses its official `duration_factor` (0.50 is faster, 2.00 is slower), while GPT-SoVITS uses the matching WebUI `speed` / `speed_factor` range (0.60–1.65). Mini-player speed only changes browser playback rate. Audio download remains unavailable for Local Runtime. Full protocol and limits: [Local Runtime protocol](docs/LOCAL-RUNTIME-PROTOCOL.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Files missing / worker spawn failed | Rescan the project; check Python, model directory or API/YAML paths in Advanced, then Test Connection. |
| Ready check says loading/unloaded/busy | Wait or manage Runtime state using its own controls. No automatic model loading is attempted. |
| HTTP 404 / invalid JSON | Check protocol and base URL. A WebUI HTML page is not a Runtime endpoint. |
| HTTP 401/403 | Runtime authorization is required or access was denied. This release does not import keys/tokens. |
| HTTP 429/503 | Runtime is busy or unavailable. Stop other inference requests and try again. |
| Timeout | Check worker/model loading logs and, if appropriate, increase startup/request timeout. |
| Reference audio missing / invalid | Choose a discovered audio or enter its existing absolute path. No voice is bundled. |
| No sound / autoplay blocked | Click the page/read button, unmute the browser, check system output. Stop then retry if Web Audio was blocked. |
| Synthesis failure | The failed read stops. Fix the Runtime issue and click read again; no cloud fallback occurs. |
| Remote browser cannot reach local Runtime | `localhost` means the machine running **dsh web**, not a remote browser's machine. |
| LAN endpoint blocked | Only loopback is allowed initially. A private RFC1918 IPv4 address needs explicit LAN consent. Public addresses/hostnames remain blocked. |

## Privacy and security

Local mode sends assistant text only from the Harness Host to the configured Runtime. It never reads Harness login credentials. Loopback `127.0.0.1` and `localhost` are allowed by default; localhost DNS is pinned to IPv4 loopback. LAN consent displays a warning because text leaves the machine. There are no automatic cloud fallbacks; this fork's inherited cloud approval announcements are disabled in Local Runtime mode. The original plugin's own cloud features are independent: disable them yourself if all speech must remain local.

Regular logs do not contain complete reply text. **Debug** explicitly enables sentence text logging; keep it off for private conversations. Local text/audio queues are in memory, bounded and released on playback acknowledgement, cancellation or expiry. The IndexTTS worker uses a temporary WAV during synthesis and deletes it after returning; abnormal termination may leave a temporary file. Your Runtime and Harness have their own logging, caching and download behavior.

Edge TTS sends text to Microsoft. RVC can use Edge TTS for base speech before local conversion. These inherited providers have separate privacy characteristics; choosing them is not equivalent to fully local synthesis. Existing upstream RVC file/voice-pack tooling is unchanged and is intended for a trusted, locally operated Harness. Do not expose the Harness/plugin to untrusted users or the public internet.

### Edge TTS cost and custom voices

The inherited Edge TTS path does not ask for an Azure Speech subscription, Azure API key or payment account, so the plugin itself does not create an Azure charge. It calls Microsoft's online Edge Read Aloud service instead. Microsoft controls that service's availability, terms, rate limits and access policy; do not treat it as a guaranteed free or unlimited production API. Microsoft describes Read Aloud as an Edge browser feature in its [official documentation](https://support.microsoft.com/en-US/edge/use-immersive-reader-in-microsoft-edge), and use remains subject to the [Microsoft Services Agreement](https://www.microsoft.com/en/servicesagreement).

Browser Read Aloud availability does not automatically grant commercial rights. Azure Speech standard voices are billed by characters. For a stable commercial service, review the current [Azure Speech pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) and applicable terms, or use a local Runtime. The plugin cannot determine licensing or regional terms for a user's content.

Edge TTS cannot train a personal voice. Microsoft's Custom Neural Voice and Personal Voice are separate Azure Speech features with Limited Access registration. Microsoft requires explicit written permission and a recorded consent statement from the voice talent, and restricts approved use cases; custom voice training and hosting are billed separately. If an IndexTTS or GPT-SoVITS Runtime supports local voice cloning/training, its model, recording and consent terms still apply. This plugin only sends the Runtime's Voice ID and never stores or uploads reference audio.

## Uninstall

Stop playback, then run:

```sh
dsh plugin --profile web remove @dsh-external/dsh-plugin-local-ai-tts
```

Restart Harness and refresh the browser. This does not uninstall or alter the original plugin or any Runtime/model. To clear this plugin's main settings first, use **Reset to defaults**; original settings are untouched. Clearing all browser site data would also clear other plugins' data.

## Development and release

```sh
npm run build
npm test
npm run test:adapter
npm pack --dry-run
```

Mock tests use Node built-ins and Python stdlib: no npm install, GPU, model downloads or cloud TTS required. `src/local-client.js` and `src/coexistence-client.js` are embedded into `lib/client.js` for the Harness module loader; commit the fragments and generated bundle and run the build check. Existing upstream live tests are opt-in and excluded from CI.

For an already running real service: `npm run smoke:runtime -- --engine indextts --endpoint http://127.0.0.1:8765 --voice default` (replace values). This checks health plus exactly three HTTP syntheses and writes no audio files. It is **not** a substitute for the real Harness/browser acceptance in [VALIDATION](docs/VALIDATION.md).

Review [CHANGELOG](CHANGELOG.md), [release validation](docs/VALIDATION.md), and [LICENSE](LICENSE) before tagging `v0.1.4`. The npm payload has an explicit file allowlist; `.gitignore` and a release scan exclude model files, private voices, recordings, environments, secrets and artifacts. Inspect the final Git diff and package before publishing. No remote GitHub publication or tag is performed automatically.

## License

MIT, with the original copyright and license preserved. No new production dependencies. See [NOTICE](NOTICE.md) for upstream attribution and separate Runtime/model/voice licensing responsibilities.
# Official WebUI backend

The local process mode can load the official engine backend in the background without opening a browser. IndexTTS 2.5 uses the installed `webui.py`; GPT-SoVITS uses the official `GPT_SoVITS/inference_webui.py` or an explicitly selected fast variant. The plugin starts and connects to the process, while upstream code owns model loading and inference.

If the detected port is already occupied, the plugin refuses to guess whether it is the same project or weights. Select Connection only after confirming the running service in Advanced settings. That mode never starts, switches weights, or stops a user-owned service. Discovery does not execute BAT files, install dependencies, or download models; the actual official startup may create caches, outputs, or missing resources according to upstream behavior.

IndexTTS requires the 2.5 model directory and a confirmed reference audio. GPT-SoVITS also needs the reference transcript/languages and an explicit saved model choice when `weight.json` has multiple pairs. The connector reads the running Gradio `/config` and API metadata instead of hard-coding event numbers.
