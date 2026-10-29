# Listing in DSH Market / 上架 DSH 插件市场

The market application (`dshmarket`) does **not** take submissions. It renders a
catalog built from [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
— one YAML file per plugin under `data/plugins/`. Listing therefore means: keep
this repository installable from source and keep that one file current.

市场应用本身不收条目，它的目录由 `awesome-dsh-plugin` 的
`data/plugins/<owner>__<repo>.yml` 生成。上架 = 仓库能被源码安装 + 维护那一个条目文件。

**Status: already listed.** PR
[#6597](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6597)
merged `data/plugins/abbccdd__dsh-localtts.yml` on 2026-10-16; the live catalog
carries this repository under `voice`. No new submission PR is needed — the
entry file is the thing to update when the feature set changes.
/ **状态：已收录。** PR #6597 于 2026-10-16 合并了
`data/plugins/abbccdd__dsh-localtts.yml`，实时目录里 `voice` 分类已可查到。
不需要再提新的收录 PR——功能有变化时更新那一个文件即可。

The copy this repo keeps in sync with the catalog is
[`submission/abbccdd__dsh-localtts.yml`](../submission/abbccdd__dsh-localtts.yml).

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
| Entry file `data/plugins/abbccdd__dsh-localtts.yml` | merged 2026-10-16 (PR #6597); our copy under `submission/` |

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

## Updating the entry / 更新条目

Edit **only** your own file, one PR. Two paths, both ending in the same PR:

```sh
# A. clone path
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin && git checkout -b update-dsh-localtts
cp <this-repo>/submission/abbccdd__dsh-localtts.yml data/plugins/abbccdd__dsh-localtts.yml
git add data/plugins/abbccdd__dsh-localtts.yml
git commit -m "Update abbccdd/dsh-localtts"
git push -u origin update-dsh-localtts
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --head abbccdd:update-dsh-localtts \
  --title "Update abbccdd/dsh-localtts" --body "Describe the current feature set; add the icon."
```

```sh
# B. API path for a one-line change (no clone of the 7.5k-entry catalog)
base=$(gh api repos/awesome-dsh-plugin/awesome-dsh-plugin/git/ref/heads/main --jq .object.sha)
gh api -X POST repos/abbccdd/awesome-dsh-plugin/git/refs \
  -f ref=refs/heads/update-dsh-localtts -f sha="$base"                 # in your fork
sha=$(gh api repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins/abbccdd__dsh-localtts.yml --jq .sha)
gh api -X PUT repos/abbccdd/awesome-dsh-plugin/contents/data/plugins/abbccdd__dsh-localtts.yml \
  -f message="Update abbccdd/dsh-localtts" -f branch=update-dsh-localtts -f sha="$sha" \
  -f content="$(base64 -w0 submission/abbccdd__dsh-localtts.yml)"
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --head abbccdd:update-dsh-localtts \
  --title "Update abbccdd/dsh-localtts" --body "Describe the current feature set; add the icon."
```

Before opening it, diff the catalog's current copy against `submission/` — if the
only difference is wording that no release changed, leave it alone.

## Rules that decide the outcome / 决定成败的几条

- **One file per PR**, and change nothing else. Both READMEs there are generated
  from `data/plugins/*.yml`; hand edits are what made hundreds of PRs
  unmergeable. Do not regenerate them locally either, and never touch another
  plugin's entry.
- **`description.en` is the only required field**, and it is read as a claim and
  checked against the code — no superlatives, no numbers you cannot point at in
  the source. If a release changes the feature set, update this entry.
- **A description containing `: ` must be quoted** or YAML parses it as a nested
  key. Both description lines in the entry are quoted for that reason.
- CI runs, in order: entry count (≤3 per PR), `dsh.bundle` fetched from this
  repo, repo age (≥1 day), `awesome-lint` and the site build. A red check names
  the fix; push to the same branch — no new PR.
- Category `voice` is the closest fit. Nobody is bounced over a category; a
  maintainer re-files it if a better one appears.
- `icon:` must be a GitHub-hosted raster; `logo.png` (280×280) in this repo is
  what the entry points at. Storefronts fall back to the owner avatar without it.
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
