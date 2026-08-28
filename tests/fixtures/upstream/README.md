# Pinned upstream compatibility fixture

`index.mjs` and `client.js` are unmodified copies of `lib/index.mjs` and
`lib/client.js` from [1624318455/dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts)
at commit `ec0cf87ef52abb81ae91681a966aa3096365e631` (version 0.3.0).

Copyright (c) 2026 dsh-plugin-tts contributors. MIT; the complete unchanged
license is at [../../../LICENSE](../../../LICENSE).

Tests load both original and forked bundles in both orders to check route,
UI and settings isolation without modifying the original plugin. These fixtures
are test sources, excluded from the npm package; no model/audio is included.
