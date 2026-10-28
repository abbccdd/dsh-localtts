# Listing in DSH Market / 上架 DSH 插件市场

The market application (`dshmarket`) does **not** take submissions. It renders a
catalog built from [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
— one YAML file per plugin under `data/plugins/`. Listing therefore means: keep
this repository installable from source, then open one PR adding
`data/plugins/abbccdd__dsh-localtts.yml`.

市场应用本身不收条目，它的目录由 `awesome-dsh-plugin` 的
`data/plugins/<owner>__<repo>.yml` 生成。上架 = 仓库能被源码安装 + 向该仓库提一个条目 PR。

The prepared entry lives at [`submission/abbccdd__dsh-localtts.yml`](../submission/abbccdd__dsh-localtts.yml).

## Requirements, and where this repo stands / 门槛与现状

| Requirement | This repo |
| --- | --- |
| `package.json` declares `dsh.bundle` (what makes `dsh plugin add` work) | yes — `dsh.bundle.patch: ./cordis.patch.yml` |
| A `cordis.patch.yml` next to it | yes — one `insert` row, id `local-ai-tts` |
| Real working code, client bundle committed so source install needs no build | yes — `lib/` is tracked, no `prepare`/`prepublish` script |
| Public repo, ≥1 day old (no commit-count bar), topic `dsh-plugin` | yes |
| `dsh.client` only because browser UI ships | yes — `platform: web` |
| Official `@deepseek-ai/*` packages as `peerDependencies`, each range with an explicit prerelease branch | yes |
| `screenshots.json` in the repo root, 1–8 images | yes — two 1051×720 PNGs under `assets/` |
| Entry file `data/plugins/abbccdd__dsh-localtts.yml` | prepared under `submission/` |

npm is optional for listing and is **not** published here: the package is scoped
`@dsh-external/`, and the catalog only links a package whose `repository` field
points back at the listed repo. Without it the entry shows no download count and
installs from GitHub source, which works because this repo ships no build step.

发 npm 对收录是可选的，本项目未发。不发只是没有下载量数字，从 GitHub 源码安装照常——
本仓库没有构建步骤，源码安装本来就是干净的。

`tarball:` is deliberately **omitted**: it is only needed when a repo cannot be
installed from source. The `github:` source install always tracks the default
branch, so a pinned release tarball would only add a stale version that has to be
bumped in the catalog by hand after every release.

`tarball:` 特意不写：它只在仓库无法源码安装时才需要。写死的 prebuilt tarball 会变成
每次发版都要手工更新的旧版本，而 `github:` 源码安装永远跟默认分支。

## Pre-flight checks / 提交前自查

```sh
# 1. The tarball pnpm builds for a git install contains the runtime files.
npm pack --dry-run    # expect lib/, cordis.patch.yml, adapters/, docs/, assets/, screenshots.json

# 2. Installing from source produces exactly ONE loader row, with no duplicate id.
dsh plugin --profile web add "github:abbccdd/dsh-localtts#main"
dsh --profile web --dump-config | grep -c "id: local-ai-tts"                        # must print 1
dsh --profile web --dump-config | grep -A3 "== @dsh-external/dsh-plugin-local-ai-tts"

# 3. The plugin's own routes answer after a restart.
curl -s -X POST http://127.0.0.1:<port>/dsh-local-ai-tts-api/diagnose -H 'content-type: application/json' -d '{}'
```

A `duplicate loader entry id: local-ai-tts` from either command means the
profile's own `cordis.patch.yml` was hand-edited and now holds a second record
for the same id (for example an `insert:` row next to a `- id:` override). DSH
refuses to boot in that state. Delete every `local-ai-tts` row from that patch
layer so it is `[]` again and let the bundle layer mount the plugin once. Same
note in the READMEs' troubleshooting tables.

## Submitting / 提交流程

```sh
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
git checkout -b add-dsh-localtts
cp <this-repo>/submission/abbccdd__dsh-localtts.yml data/plugins/abbccdd__dsh-localtts.yml
git add data/plugins/abbccdd__dsh-localtts.yml
git commit -m "Add abbccdd/dsh-localtts"
git push -u origin add-dsh-localtts
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --head abbccdd:add-dsh-localtts \
  --title "Add abbccdd/dsh-localtts" \
  --body "Local TTS playback for DeepSeek Harness (voice)."
```

## Rules that decide the outcome / 决定成败的几条

- **One file per PR**, and change nothing else. Both READMEs there are generated
  from `data/plugins/*.yml`; hand edits are what made hundreds of PRs
  unmergeable. Do not regenerate them locally either.
- **`description.en` is the only required field**, and it is read as a claim and
  checked against the code — no superlatives. If a release changes the feature
  set, update this entry in a follow-up PR.
- **A description containing `: ` must be quoted** or YAML parses it as a nested
  key. Both description lines in the prepared entry are quoted for that reason.
- CI runs, in order: entry count (≤3 per PR), `dsh.bundle` fetched from this
  repo, repo age (≥1 day), `awesome-lint` and the site build. A red check names
  the fix; push to the same branch — no new PR.
- Category `voice` is the closest fit. Nobody is bounced over a category; a
  maintainer re-files it if a better one appears.
- Listing is **not** a security review. Keep the READMEs' privacy section and the
  "connector, not a model distribution" boundary explicit — that is the part a
  visitor needs before installing.

## After merge / 收录之后

- The catalog site rebuilds and the market shows the entry within about a day;
  nothing else here needs to change.
- Screenshots: push new images to this repository and edit `screenshots.json` —
  no catalog PR, the next nightly build picks them up.
- Description, category or icon changes: one PR editing the same entry file.
- Entries are not permanent: a repo that disappears, is archived or goes dormant
  gets flagged, then removed after review.
