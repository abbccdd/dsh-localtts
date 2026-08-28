# Legacy Local Runtime HTTP protocol

This document describes the retained HTTP compatibility adapter. New
installations should use the process launcher and [JSONL worker protocol](PROCESS-WORKER-PROTOCOL.md),
which starts a configured IndexTTS/GPT-SoVITS worker without requiring a
WebUI or a manually started Runtime endpoint.

## Provider abstraction

`LocalRuntimeProvider` defines `synthesize({text, voice, engine, options})`, `listVoices()`, `healthCheck()` and `cancel()`. `IndexTTSAdapter` and `GPTSoVITSAdapter` select engine identities; transport selection is separate. New engines can implement the same four methods and register in `createProvider`, without changing Harness event handling or the player.

`options` must currently be empty. The process connector passes the saved model controls as worker startup arguments: IndexTTS `--duration-factor` (official `duration_factor`) and GPT-SoVITS `--speed-factor` (mapped to the official API/WebUI `speed` or `speed_factor` field). Browser playback uses the Runtime's original audio duration and sample rate; the mini-player speed is independent of model synthesis. Pause/resume/stop remain available.

```json
{"provider":"local-runtime","engine":"indextts","endpoint":"http://127.0.0.1:8765","voice":"default","protocol":"auto","timeoutMs":120000,"allowLan":false,"debug":false}
```

The UI stores transport fields under `localRuntime` in its own `dsh-local-ai-tts-settings` localStorage entry, beside `provider`, `autoRead` and `coexistenceMode`. Original plugin settings are never written or deleted. The browser talks to the isolated Host route `/dsh-local-ai-tts-api/local-runtime`; external Runtime URLs/protocols are unchanged by coexistence. Endpoint is empty by default; sample ports are examples only. `default` is a Runtime-defined voice alias, not a bundled voice.

## Transport variants

| Protocol | Health | Optional voices | Synthesis |
| --- | --- | --- | --- |
| `runtime-v1` | `GET /health` | `GET /voices` | `POST /synthesize` |
| `openai-speech` | `GET /health` | `GET /v1/audio/voices` | `POST /v1/audio/speech` |

`auto` selects runtime-v1 for IndexTTS and openai-speech for GPT-SoVITS. Either engine can explicitly use either protocol. Paths append to the configured endpoint, including any base path. Do not add `/v1` to the base URL when the service uses `/v1/audio/speech` at its root.

Health: `{ "status": "ready" }` or `{ "ready": true }`. `ok:false` or `ready:false` overrides success. `loading`, `unloaded`, `busy` and `error` are shown as not ready. Optional `engine` must match the selection. A 2xx response alone does not imply readiness.

Voices: `["default","voice-a"]` or `{ "voices": [{"id":"voice-a","name":"Voice A"}] }`. 404/405/501 means discovery is unsupported; manual Voice ID remains available. Other discovery failures are warnings, separate from health.

One synthesis request contains exactly one sentence/segment:

```json
{"text":"A single sentence.","voice":"default","engine":"indextts"}
```

Speech API equivalent:

```json
{"input":"A single sentence.","voice":"default","model":"gpt-sovits","response_format":"wav"}
```

This is a bridge contract, not a claim that every stock IndexTTS/GPT-SoVITS WebUI implements it. Stock GPT-SoVITS `/tts` APIs requiring reference paths and inference settings are not used; connect an existing compatible Runtime bridge instead. Authenticated services returning 401/403 must be configured by their owner; this version does not handle API keys or fetch Harness credentials.

Responses may be `audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/ogg`, `audio/flac` (browser decoder support required), or JSON:

```json
{"format":"s16le","sample_rate":22050,"channels":1,"pcm_base64":"AAA="}
```

PCM supports one or two channels, 8–192 kHz. It is wrapped in a WAV container without resampling. Response cap: 16 MiB; JSON metadata cap: 1 MiB. HTTP redirects are rejected, timeout covers headers and body, and errors omit arbitrary Runtime response text. Network requests bypass environment HTTP proxies and do not forward browser cookies or authentication headers.

## Sentence and queue semantics

Chinese `。！？` and English `.!?` end a sentence. Decimal points between digits are exempt. An English period at the end of a streaming delta waits for the next character or final flush. At about 55 characters, soft punctuation `，；：,;:` can split a long sentence; 70 Unicode code points is the hard limit. Short sentences are never merged. English abbreviations may split at a period; this release does not implement linguistic abbreviation detection.

The Host listens to the existing `session/event` API: `assistant/chunk` with `data.chunk.type="text-delta"`, then `assistant/message` and `turn/end`. `data.turn`, `data.step`, session ID and event `seq` prevent replay. Final-message text is only used if that step had no streamed text. React completion effects do not synthesize again in Local Runtime mode. Only the active subscribed session is read; historical replies are not replayed on initial subscription.

Message observers enqueue and return immediately. Synthesis is serial per browser and runs separately from playback. Three unacknowledged segments apply backpressure. Browser Web Audio schedules buffered segments consecutively and acknowledges them after playback, so pause does not consume unbounded memory. Slow synthesis can still cause audible gaps; the plugin cannot promise zero gaps when the Runtime is slower than speech.

Stop aborts the HTTP request, drops queued audio and suppresses the rest of that automatic turn. It does not kill a Python process or interrupt an already running GPU kernel unless the Runtime itself responds to HTTP disconnect. Config changes cancel old work. Per-browser subscriptions expire after 30 seconds without polling; jobs have a 30-minute safety limit. Total queued text is capped at 100,000 characters. Independent browser tabs can each read; they are not a global one-speaker election.

Local audio and text queues live only in Host/browser memory and are released on acknowledgement, stop, expiry or disposal. No local audio cache files are created. Raw streaming text may include Markdown punctuation/code; completed manual reads use the upstream plain-text cleanup.

## Optional Python facade

`adapters/python_http.py` is an independent stdlib-only facade for a Runtime object that is **already created and has a voice loaded**. It imports no model code and starts/installs nothing automatically. From the existing owner script, add the adapter directory to that process's module search path and call:

```python
from python_http import make_server

# runtime already exists; configure its models/voice outside this connector.
server = make_server(runtime, engine="indextts", port=8765)
server.serve_forever()
```

Use `engine="gpt-sovits"` with protocol `runtime-v1` for an existing GPTSoVITSRuntime object. The facade calls only `list_voices()`, `load_voice(id)` and `synthesize(text=text)`. `default` keeps the currently loaded voice. It cannot attach to an arbitrary object in a different process. Its ready status means the supplied object's facade is available; the owner must initialize the object before exposing it. Concurrent synthesis is rejected with 429. No model inference settings are overridden. Shutting down the HTTP server does not close or modify the supplied Runtime.
# 官方 WebUI 后端连接

`mode: process` 的 `launchPreset: webui` 使用 `adapters/gradio-worker.py`。worker 先读取同源 `/config` 和 API 信息，再按参数名称选择唯一的合成接口：IndexTTS 为 `gen_single`，GPT-SoVITS 普通分支为 `get_tts_wav`，fast 分支为 `inference`。事件编号不写死。

参考音频通过 `gradio_client.handle_file()` 上传到同一 localhost 服务；输出仅接受同源、受大小限制的 WAV 文件。Gradio 客户端关闭隐式 Hugging Face token、遥测、代理、重定向和远程下载。未知 API、多个候选、非本机地址或非 WAV 输出都会失败并要求人工配置。

`webuiMode: auto` 在端口为空时启动官方入口；检测到未由本插件识别的现有服务会返回 `EXTERNAL_SERVICE`，此时请确认地址和模型后切换 `webuiMode: attach`。`attach` 模式只连接，不发送模型切换或进程控制请求。
