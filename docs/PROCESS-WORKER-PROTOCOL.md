# Local process worker protocol

The plugin starts the configured executable with `shell:false` and exchanges
newline-delimited UTF-8 JSON on stdin/stdout. A worker must keep stdout clean:
diagnostics belong on stderr.

Requests contain an `id` and `action`:

```json
{"id":"...","action":"health"}
{"id":"...","action":"voices"}
{"id":"...","action":"synthesize","engine":"indextts","voice":"default","text":"你好。"}
```

Responses must contain the same `id`. Successful audio is base64 encoded WAV
or another browser-decodable format:

```json
{"id":"...","ok":true,"ready":true,"status":"ready"}
{"id":"...","ok":true,"voices":[{"id":"default","name":"default"}]}
{"id":"...","ok":true,"mime":"audio/wav","audioBase64":"UklGR..."}
```

Failures use `{ "ok": false, "code": "...", "error": "..." }`. The plugin
only logs request id, character count, elapsed time, status and error. Full
text is logged only when the user explicitly enables Debug.

For the built-in adapters, model controls are fixed at worker startup from
the settings panel: IndexTTS receives `--lang` and
`--duration-factor`; GPT-SoVITS receives `--prompt-lang`, `--text-lang` and
`--speed-factor`. A custom worker may ignore these arguments, but it must keep
the JSONL request and response contract above.
