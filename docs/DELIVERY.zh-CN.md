# v0.1.6 发布候选版交付报告

## 1. 上游复用

本地 fork 基于 `1624318455/dsh-plugin-tts` 提交 `ec0cf87ef52abb81ae91681a966aa3096365e631`，当前发布候选版为 `v0.1.6`。复用 Host/client 插件注册、assistant 消息按钮、Auto Read 开关、既有 Edge/RVC 链路、长文本播放、停止/暂停、主题与设置持久化。源码已推送到 `abbccdd/dsh-localtts`。

开始时发现的未提交 Local Runtime 草稿已先备份到仓库之外，再由模块化实现替代。该草稿的固定个人音色、端口及整段请求逻辑未进入新连接器。

## 2. 文件

新增核心：`lib/local-runtime/provider.mjs`、`sentence-buffer.mjs`、`service.mjs`，`src/local-client.js`。

共存更新：`lib/coexistence.mjs`、`src/coexistence-client.js`、`tests/coexistence.test.mjs`、未修改的上游测试快照 `tests/fixtures/upstream`、`docs/COEXISTENCE.md`。包名、路由、浏览器设置、样式和 UI 标识隔离；自动检测原版并只提供本地补充功能。原版代码和设置不修改。

新增独立 HTTP 薄适配：`adapters/python_http.py`。只接收已创建的 Runtime 对象，不导入、创建、安装或改造模型。

新增验证/工具：`tests/local-runtime.test.mjs`、`tests/local-client.test.mjs`、`tests/test_http_adapter.py`，`tools/build-client.mjs`、`release-check.mjs`、`smoke-runtime.mjs`、`preview-server.mjs`。

修改：`lib/index.mjs`、`lib/client.js`、`tests/client-load.mjs`、`tools/gen-ui-preview.mjs`、`package.json`、`cordis.patch.yml`、`.gitignore`、`.github/workflows/test.yml`。

文档：重写 `README.md`，新增 `README.zh-CN.md`、`CHANGELOG.md`、`NOTICE.md`、`docs/LOCAL-RUNTIME-PROTOCOL.md`、`docs/VALIDATION.md` 和本报告；旧 `README.zh.md` 转向新中文文档。`LICENSE` 原样保留。

## 3. 协议

统一接口：`synthesize({text, voice, engine, options})`、`healthCheck()`、`listVoices()`、`cancel()`。支持 Runtime v1 与 Speech API 两种 HTTP 映射，响应支持音频容器或 s16le PCM JSON。输入严格为一个句子/软切片段；55 字附近软切、70 字硬限制。无推理参数覆盖。细节见 [协议说明](LOCAL-RUNTIME-PROTOCOL.md)。

## 4–5. 两种引擎适配结果

| 引擎 | 已完成 | 未完成 |
| --- | --- | --- |
| IndexTTS | runtime-v1 adapter、PCM/WAV、health/voices、mock 测试、现有 Python 方法签名核对 | 真实 HTTP Runtime + Harness 连续播放 |
| GPT-SoVITS | 现有 Speech bridge 路径/请求结构核对、adapter、mock 测试；也支持显式 runtime-v1 | 真实 HTTP Runtime + Harness 连续播放 |

两个 Runtime 的内部文件、模型权重和推理参数均未修改。测试前未启动任何模型服务。

## 6. 自动化测试

32 项 Node 测试、52 项客户端加载/设置检查、6 项 i18n 检查、1 项 Python unittest（覆盖两种引擎）通过。测试覆盖配置、health、两种 adapter、离线、超时、取消、严格三句三请求、重复事件、失败恢复、切换 engine/voice、设置持久化、预取上限、暂停、会话隔离及 Auto Read OFF 保留手动朗读；其中 12 项涵盖共存、双加载顺序、原版设置保护、切换/禁用、迁移和自动朗读让位。

`npm test`、`npm run test:adapter`、生成文件一致性、发布文件扫描和 `git diff --check` 已执行。CI 为 Node 22/24 + Python 3.11，全部 mock，无 GPU/模型依赖；远程 GitHub CI 尚未运行。

## 7. 实机测试

已做实际浏览器静态布局检查，修正主题输入框及 Local Runtime 页脚。它不是实际 Harness 应用验收。

真实端到端测试未完成：未确认运行中的 Harness 与两套 Runtime HTTP 地址。对文档示例端口的最后 health 探测均为 `ECONNREFUSED`，未继续发送合成请求。不能把 mock Web Audio 调度测试称为真实模型连续播放。完整验收步骤在 [VALIDATION](VALIDATION.md)。

## 8. 安装命令

当前本地仓库：

```sh
dsh plugin --profile web add "file:/path/to/dsh-plugin-local-ai-tts"
```

从 GitHub 安装当前源码：

```sh
dsh plugin --profile web add github:abbccdd/dsh-localtts
```

可以与上游同时启用。检测到原版后，本插件显示“本地语音”和 Local 按钮，并跳过重复的 Edge/RVC、选中文本朗读、快捷键与审批播报。原版 Auto Read 开启或状态未知时，本地自动朗读暂停；手动仍可用。安装后重启 `dsh web` 并刷新页面。卸载：`dsh plugin --profile web remove @dsh-external/dsh-plugin-local-ai-tts`。不会卸载原版或删除其设置。真正 Harness 双插件运行仍待实机验收。

## 9. README

中英文已完成：项目用途、IndexTTS/GPT-SoVITS 进程 worker、模型不随插件分发、安装命令、路径/参数配置、Auto Read、常见错误、隐私、卸载和发布检查均有说明。

## 10. License / attribution

上游 MIT LICENSE 和 `Copyright (c) 2026 dsh-plugin-tts contributors` 完整保留，发布检查固定校验规范化 LICENSE 的 SHA-256。README/NOTICE 注明项目与提交。未新增生产依赖；继承的 Cordis、Harness web 和 React peer dependency 的安装包声明均为 MIT。不包含两个模型的代码或权重，模型/音色许可由运营者另行确认。

## 11. 排除文件

`.gitignore` 排除 checkpoints、weights、模型文件、voice cache、用户音色目录、参考录音、生成音频、Python/Node 环境、日志、凭据文件、环境配置、私有本地配置、压缩包和 artifacts。npm 发布文件白名单已通过 `npm pack --dry-run` 核对，无模型或用户音频。进程 Provider 默认不含可执行文件、模型路径或私人音色。

原始草稿备份在仓库外；静态预览 HTML、Python 缓存和截图被 Git 排除。忽略规则不阻止人为 `git add -f`，发布前仍应人工看 diff/打包清单。上游 RVC 文档中的示例部署路径不是本机运行配置，也不被 Local Runtime 使用。

## 12. 人工发布门槛

仍需提供/确认：运行中的 Harness 页面、两个 worker 的本地 Python/项目/模型或参考音频路径和音色；完成三句话三请求且连续播放的两套验收；确认 GitHub owner/repo/tag 并替换 README 模板；运行远程 CI；确认 Runtime/模型/音色授权；审查上游 Edge/RVC 的可信本地部署边界。

当前交付为可继续验收的仓库和 v0.1.6 发布候选版；尚未打稳定版 tag 或发布 npm 包，也不能声称全部用户验收要求已完成。
