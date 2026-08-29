# DSH Marketplace submission

This repository is prepared for the community DSH plugin catalog. The listing must use an accurate, plain description and the `voice` category.

```yaml
url: https://github.com/abbccdd/dsh-localtts
name: abbccdd/dsh-localtts
category: voice
tarball: https://github.com/abbccdd/dsh-localtts/releases/download/v0.1.8/dsh-external-dsh-plugin-local-ai-tts-0.1.8.tgz
description:
  en: Adds local IndexTTS 2.5 and GPT-SoVITS sentence-level synthesis and playback to DeepSeek Harness.
  zh: 为 DeepSeek Harness 增加本地 IndexTTS 2.5 与 GPT-SoVITS 的逐句合成和播放。
```

## Repository checklist

- `package.json` declares `dsh.bundle.patch` and the web client platform.
- `cordis.patch.yml` is present at the repository root.
- The MIT `LICENSE`, upstream attribution, English README and Simplified Chinese README are present.
- The repository has at least ten commits and uses the `dsh-plugin` topic.
- `screenshots.json` points to current, path-free Simplified Chinese UI captures.
- The `v0.1.8` prerelease includes a prebuilt npm tarball for one-click installation without repository build approval.
- Model weights, reference audio, voice caches, Python environments and generated audio are excluded.
- The repository must be public and at least one day old before opening the catalog pull request.

The source install command is:

```sh
dsh plugin --profile web add github:abbccdd/dsh-localtts
```

The catalog entry belongs in `data/plugins/abbccdd__dsh-localtts.yml` in `awesome-dsh-plugin/awesome-dsh-plugin`. Regenerate that catalog's English and Chinese READMEs according to its contribution guide before opening the pull request.
