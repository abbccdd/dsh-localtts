# Coexistence / 与原版共存

This fork supports the original `@dsh-external/dsh-plugin-tts` without modifying it.
Compatibility tests pin upstream version 0.3.0, commit
`ec0cf87ef52abb81ae91681a966aa3096365e631`. They do not establish compatibility
with every future upstream release or a real installed Harness session.

## Isolation first

| Resource | Original | Local AI TTS |
| --- | --- | --- |
| Host plugin name | `tts` | `local-ai-tts` |
| Package/module | `@dsh-external/dsh-plugin-tts` | `@dsh-external/dsh-plugin-local-ai-tts` |
| API prefix | `/dsh-tts-api/` | `/dsh-local-ai-tts-api/` |
| Legacy audio prefix | `/dsh-tts-audio` | `/dsh-local-ai-tts-audio` |
| Main browser settings | `dsh-tts-settings` | `dsh-local-ai-tts-settings` |
| Language/pack state | `dsh-tts-*` | `dsh-local-ai-tts-*` |
| Settings slot key | `tts` | `local-ai-tts` |
| Settings getter | `__dshTtsSettings` | `__dshLocalAiTtsSettings` |
| Styles/tooltips | `dsh-tts-*` / `data-tts-tip` | `dsh-local-ai-tts-*` / `data-local-ai-tts-tip` |
| Legacy RVC managed directory, under user home | `.dsh/tts-rvc` | `.dsh/local-ai-tts-rvc` |

The fork's standalone RVC pack directory override is `DSH_LOCAL_AI_TTS_PACKS_DIR`.
It no longer consumes `DSH_TTS_PACKS_DIR`. No files from the original managed
directory are moved, deleted or copied. Local Runtime never uses these directories.
If a user explicitly points both plugins at the same RVC service/model files,
that external resource is still shared and is outside plugin isolation.

## Detection and feature ownership

The Host checks only names and enabled/disabled flags in the public
`ctx.get('loader').entries()` inventory, when available. If the original is
enabled, the fork skips its own legacy Edge/RVC routes and approval subscription.
An interval rechecks the inventory, removes only this fork's legacy registrations
on enable, and restores them on disable. The Local Runtime route remains available.
If inventory is unavailable, all fork routes remain separately named and therefore
do not collide in either load order. No private route table is read or patched.

The browser uses public loader inventory, or the Harness `__DSH_BOOT__.entries`
module manifest, falling back to the original's exported settings getter in older
versions. A manifest identifies the original before its client factory runs.
The package name is matched exactly; arbitrary renamed forks are not guessed.
The manual companion setting handles unknown variants without changing them.

In companion mode, the fork forces Local Runtime and hides its Edge/RVC options,
download action and selection reader. Its generic keyboard handler and approval
poller are inactive. Distinct local message/Auto Read buttons and a local settings
tab remain; they cannot be folded into the original UI through an API the original
does not export. Local pause/stop controls still work. Standalone mode retains the
inherited providers and UI.

Installing only the original plugin does not create the local process providers
or start an IndexTTS/GPT-SoVITS worker. This fork starts only the worker command
the user explicitly configures.
Original Edge TTS is cloud based and needs no local endpoint. Original RVC's
`baseUrl` identifies an RVC inference server and cannot be assumed to implement
the IndexTTS or GPT-SoVITS adapter protocol. A user who has no separately running
compatible Runtime will see Local Runtime as offline while the original features
continue to work; this is expected. The fork does not install, start or discover
that missing service.

## Auto Read safety and limits

Only a boolean `false` from the original's exported Auto Read getter permits
local automatic speech in companion mode. `true`, missing or unreadable state
blocks it. The getter is read-only; no Harness credentials or plugin config body
are read. The local preference is preserved while suspended, and the displayed
toggle shows its effective OFF state with an explanation in settings.

Browser polling (200/500 ms while active, subject to browser throttling) updates
Host eligibility and stops local automatic audio/queues when the original turns
on. Eligibility is checked again before scheduling decoded audio. Manual local
reading stays available. This is **not atomic cross-plugin mutual exclusion**:
an original notification/manual read or a simultaneous toggle may overlap audio.
The original has no shared playback lock or provider extension API. Users must
stop original audio and disable its Auto Read before local automatic playback.
Do not claim the original's cloud calls are controlled by this fork.

Forced companion mode without readable original state deliberately allows only
manual local reads. Disabling the original with only the legacy getter available
requires a full browser refresh. Normal install/enable/disable changes should be
followed by a Harness restart and refresh for consistent server/client inventory.

## Settings and validation

On first run, old main settings may be copied once into the new key, with Auto Read
and approval alerts set OFF. A migration marker prevents repeated imports after
reset. Original keys are never written or deleted. New settings, language and pack
state thereafter remain independent. Reset removes only the fork's main settings;
uninstalling the fork leaves the original installed.

GPU-free tests load **unmodified original Host and client bundles** from
`tests/fixtures/upstream` in both orders. They cover route and UI collision checks,
independent disposal, settings/reset isolation, migration/reload, missing inventory,
late detection, disabled plugins, manual mode persistence and Auto Read gating.
Controller tests additionally verify cancellation of scheduled automatic audio
and continued manual playback after upstream state changes.

Real Harness coexistence and audible playback remain pending. In addition to
[Runtime acceptance](VALIDATION.md), install/enable both plugins in each order,
confirm two distinct settings tabs, verify original Edge/RVC still work, switch
Auto Read ownership, and disable/re-enable each plugin without losing settings.
No remote publication, automatic installation or model change is performed.
