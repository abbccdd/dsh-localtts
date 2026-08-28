# Attribution and dependencies

This is a derivative of [1624318455/dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts), based on commit `ec0cf87ef52abb81ae91681a966aa3096365e631`.

The complete upstream MIT license and copyright notice are retained, unchanged, in LICENSE:
Copyright (c) 2026 dsh-plugin-tts contributors.

Reused: Harness Host/client registration, message actions, Auto Read toggle, message deduplication for existing providers, Edge/RVC synthesis paths, long-read playback, settings persistence, themes, translations, controls, and upstream tests. The local process providers add a small JSONL process boundary and keep the existing sentence queue/playback flow. The retained HTTP adapter is compatibility-only.

The coexistence tests include unmodified upstream Host/client fixtures at the pinned commit in `tests/fixtures/upstream`, under the same MIT license. They are excluded from the npm package. The fork's coexistence changes isolate names/settings and conditionally deactivate its duplicate features; they do not patch the installed original plugin.

No production dependency was added. Node.js built-ins provide transport, cancellation and tests. The browser uses the host-provided React and Web Audio APIs. Existing peer dependencies are `@deepseek-ai/cordis`, `@deepseek-ai/dsh-web`, and React (MIT declarations in the installed packages were checked during preparation). Their installed versions and transitive dependencies belong to the Harness installation; this project does not vendor them.

The inherited Edge worker mirrors node-edge-tts protocol behavior, as documented in the upstream source. Its public protocol token is not a user API key. Edge TTS is an external Microsoft service; use is subject to that service's terms. RVC may synthesize its base speech through Edge before local conversion.

IndexTTS and GPT-SoVITS are separately distributed third-party projects. No source from their model implementations, model weights, voice packs, reference audio, inference environments or caches is distributed here. Their code/model/voice licenses must be checked separately by Runtime operators. MIT licensing of this connector does not grant rights to any model or voice.
