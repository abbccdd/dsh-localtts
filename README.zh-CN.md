# DeepSeek Harness Local AI TTS Plugin

[English](README.md) | 简体中文 · **v0.1.5 发布候选版** · MIT

为 DeepSeek Harness 增加本地进程 TTS Provider。插件启动用户已安装的 **IndexTTS 2.5** 或 **GPT-SoVITS** worker，逐句合成并在浏览器播放，不需要打开 WebUI。合成、播放与 Harness 消息生成独立进行。

基于 [1624318455/dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts)，上游提交 `ec0cf87ef52abb81ae91681a966aa3096365e631`。复用消息朗读按钮、Auto Read、Edge/RVC Provider、停止/暂停、设置面板、持久化与 Harness 插件 API。保留上游 MIT 版权和 LICENSE，详见 [NOTICE](NOTICE.md)。

**插件不包含模型。** 不安装、裁剪、训练或修改模型；只启动用户配置的 worker 命令。不打包权重、参考音频、用户音色缓存、Python 环境或生成音频。

```text
Harness assistant 回复 → SentenceBuffer → Local Process Provider
                                            ↓ JSONL stdin/stdout
                                 IndexTTS / GPT-SoVITS Adapter
                                            ↓ PCM / Audio
                                      浏览器 Web Audio
```

## 支持范围与要求

- DeepSeek Harness web profile，提供 `webServer`、`session/event` 和客户端 UI slots；Node.js 22+，浏览器支持 Web Audio。
- 已安装的 IndexTTS 2.5 或 GPT-SoVITS、对应 Python 环境和模型文件。
- Worker 需实现 [JSONL worker 协议](docs/PROCESS-WORKER-PROTOCOL.md)。`adapters/` 中提供两个只负责连接的示例，不包含权重。

并非任意原版 WebUI 或 `/tts` API 都能直接连接。协议必须匹配，[接口说明](docs/LOCAL-RUNTIME-PROTOCOL.md)包含准确请求/响应格式。两个引擎的 mock 测试已通过；真实 Harness + 两套 Runtime 的播放验收仍是发布门槛，见 [验证记录](docs/VALIDATION.md)。

## 安装

**可以与原版同时安装和启用，不需要卸载原版。** 本插件使用独立的包名、路由、设置和界面标识；检测到原版后自动进入本地补充模式，详见下文。

从 GitHub 安装当前源码：

```sh
dsh plugin --profile web add github:abbccdd/dsh-localtts
```

本地开发时，也可以安装工作区目录：

```sh
dsh plugin --profile web add "file:/path/to/dsh-plugin-local-ai-tts"
dsh web
```

重启 `dsh web` 并刷新浏览器。在 Windows 上，`file:` 安装可能复制文件；修改源码后需要重新安装该本地包。不要修改 Harness 核心。

## 配置本地进程（IndexTTS 2.5 / GPT-SoVITS）

打开 **设置 → 插件 → 语音 · Local AI TTS**，正常安装只需处理三项：

1. **引擎**：选择 IndexTTS 2.5 或 GPT-SoVITS。
2. **项目文件夹**：粘贴已有安装的完整目录，离开输入框时自动查找，也可点击 **自动查找文件**。支持项目根目录，以及常见的外层整合包目录。
3. **参考音频**：只有一个候选时自动填入；多个候选时从列表选择；不在列表中的音频可手动填写完整路径。

主界面还提供「合成语言」和当前模型原版的「语速／时长系数」。首次测试连接需要加载官方模型，可能会等待一段时间；请保持设置页面打开，不要重复点击。

不需要逐个填写 Python、启动脚本、模型权重或配置文件，也不用手写启动参数和 JSON。设置自动保存；**保存设置**可再次确认保存。

**高级设置默认折叠。** 自动发现不完整、有多个 Python/模型候选，或你使用外部 Conda 环境、自定义模型目录时，才需展开调整。GPT-SoVITS 的参考音频原文和语言也在这里：部分模型要求原文，插件不能从文件名可靠推断。不会替用户随机选取 .pth / .ckpt。

路径指的是 **运行 Harness 的电脑**。发现操作只读检查指定目录，不启动引擎、不安装依赖、不下载模型。**Test Connection** 会实际启动 worker；worker 响应并不保证合成成功，还需要试听一小段。

再次扫描同一项目会保留手动覆盖的路径；更换项目或引擎会清除上一套启动路径、参考音频和提示文本。缺文件会明确提示，不会改用云端。

自动发现范围、必要文件与官方启动依据见 [目录识别说明](docs/ENGINE-DISCOVERY.md)；自定义 worker 的底层协议见 [PROCESS-WORKER-PROTOCOL.md](docs/PROCESS-WORKER-PROTOCOL.md)。

## 与原版共存

| 环境 | 本插件行为 |
| --- | --- |
| 没有启用原版 | 独立提供 Edge TTS、RVC、Local Runtime。 |
| 检测到原版 | 只提供 Local Runtime；Edge/RVC、选中文本朗读、通用快捷键、审批播报交给原版。 |
| 自动检测不适用的旧版 Harness/其他 fork | 在共存检测中选择 **始终仅提供本地功能**。无法确认原版 Auto Read 状态时，仅支持手动本地朗读。 |

消息旁保留原版按钮，并增加标有 **Local** 的本地按钮；设置和自动朗读入口分别标为 **本地语音**、**本地 Auto Read**。原版没有公开的第三方 Provider 注册接口，因此这里不会把 Local Runtime 注入原版下拉框，也不会修改原版代码。

使用本地自动朗读前，请**先关闭原版 Auto Read，再开启本地 Auto Read**。原版开启或状态未知时，本地自动朗读暂停；检测到状态变化会取消本地自动队列，但不打断手动本地朗读。此检查按浏览器轮询进行，不是两个播放器的原子互斥；请勿同时点击两个手动朗读按钮，原版已经开始的音频也不会被本插件强行停止。

设置、语言和音色包状态独立保存；首次启动只读复制旧 TTS 主设置，并将导入的 Auto Read 和审批播报设为 OFF。保存、恢复默认和卸载本插件均不改写原版设置。浏览器清理整个站点数据仍会清除其他插件数据，不建议用它做单插件卸载。切换启用状态后建议重启 Harness 并刷新页面；旧 Harness 无插件清单时，禁用原版后必须刷新才能排除残留设置 getter。

Host 有公开插件清单时，会省略本插件自己的 Edge/RVC 路由；没有清单时保留独立命名的路由，因此加载顺序仍不会撞路由。更详细的边界与测试见 [共存说明](docs/COEXISTENCE.md)。

## Auto Read、手动朗读与播放控制

1. 测试连接后，可使用原有预览和 assistant 消息朗读按钮。先点击一次页面，允许浏览器播放音频。
2. 在输入区开启 **Auto Read**；共存时先关闭原版，再开启 **本地 Auto Read**。只朗读当前会话后续生成的 assistant 文本，不因刷新重播历史消息。
3. 每个完整句子立即入队，支持“Harness 生成第 3 句、Runtime 合成第 2 句、浏览器播放第 1 句”。
4. 回复尚未完成时也有本地播放控制条。**暂停/继续**控制音频，**停止**丢弃待播队列，当前自动回复余下内容不再朗读；进程 worker 内正在执行的推理不保证被立即终止。
5. 关闭 Auto Read 不打断手动朗读；切换 engine、voice、endpoint 会停止旧任务。重复 React 渲染、完成消息和重复序号事件不重新合成。

中文 `。！？` 和英文 `.!?` 切句，小数点有例外。长句约 55 字后优先按软标点切分，70 个 Unicode 字符硬上限；短句绝不合并，三句严格三次请求。最多预取三段。Runtime 慢于实际语速时仍可能出现间隙。

设置中的「合成语言」和「语速／时长系数」直接传给官方模型：IndexTTS 使用原版 `duration_factor`（0.50 更快，2.00 更慢），GPT-SoVITS 使用对应 WebUI 的 `speed`／`speed_factor`（范围 0.60–1.65）。播放控制条的倍速仍只改变浏览器播放速度，不改变模型合成。Local Runtime 暂不提供音频下载；原有其他 Provider 的功能保留。完整边界及取消语义见 [协议文档](docs/LOCAL-RUNTIME-PROTOCOL.md)。

## 常见错误

| 状态/错误 | 处理方式 |
| --- | --- |
| 文件未找到 / worker 启动失败 | 先重新自动查找；高级设置中检查现有 Python、模型目录或 API/YAML 路径，再测试连接。 |
| loading / unloaded / busy | 等待或用 Runtime 自己的管理方式处理；插件不主动加载模型。 |
| Worker 返回异常/非 JSON | 检查 worker 是否遵守 JSONL 协议；WebUI 页面不是 worker。 |
| HTTP 401/403 | Runtime 需要鉴权或拒绝访问；本版不读取/导入任何登录凭据。 |
| HTTP 429/503 | Runtime 繁忙或不可用，停止其他推理后重试。 |
| 请求超时 | 检查 Runtime 日志，按需增大高级设置中的启动/请求超时；进程模式最多 600000 毫秒。 |
| 参考音频无效/未找到 | 从候选列表选择，或填写已有参考音频的完整路径；插件不附带音色。 |
| 没有声音/自动播放受限 | 点击页面，检查浏览器静音与系统输出；停止后重试。 |
| 合成失败 | 当前朗读停止，但插件仍可使用；修复 Runtime 后再次朗读，不会自动发到云端。 |
| 远程浏览器连接失败 | localhost 指的是运行 `dsh web` 的主机，不是远程浏览器所在机器。 |
| 局域网地址被拒绝 | 默认仅允许 loopback；RFC1918 私有 IPv4 必须明确勾选局域网许可，公网地址/域名仍禁止。 |

## 旧版 HTTP Runtime 兼容附录

已有 HTTP 设置仍可迁移，但不再是主流程；`local-runtime` 仅保留内部兼容。插件不会替这类旧设置启动外部 HTTP 服务，也不会把模型目录当作 Endpoint。具体设置结构见 [旧 HTTP 协议](docs/LOCAL-RUNTIME-PROTOCOL.md)。更换项目目录后使用内置进程启动方式。

如果只有模型文件或可导入的 Python 对象，请使用上面的内置 Local Engine Launcher。随插件提供的 `adapters/python_http.py` 只是在已有 Runtime 对象外接兼容 HTTP 薄适配的可选工具，不创建、安装或修改模型。

## 隐私与安全

Local Runtime 模式只从 Harness Host 向配置的 Runtime 发送待朗读文本，不读取 Harness 登录凭据，不自动回退云端。默认只允许 `127.0.0.1`、`localhost`，后者固定解析为 IPv4 loopback。局域网许可会提示文本离开本机。Local Runtime 模式禁用本插件继承的云端审批提醒；共存时原版自身的云端功能不受本插件控制，如需完全本地处理，请自行关闭原版相关功能。

普通日志不记录完整回复；只有显式 **Debug** 模式允许记录句子文本，处理隐私内容时请关闭。音频和文本在内存中排队，播放确认、停止或过期后释放。IndexTTS worker 会在合成时使用临时 WAV 并在返回后删除；异常终止可能留下临时文件。Harness 和 Runtime 自己的日志、缓存及下载策略需另行检查。

Edge TTS 会向微软发送文本；RVC 可能先用 Edge 生成基底语音再本地转换，因此不等于完全本地。上游 RVC 文件/音色包工具保持原样，适用于可信的本地 Harness；请勿把 Harness 或插件暴露给不可信用户/公网。

### Edge TTS 的费用和自定义音色

本插件继承的 Edge TTS 路径不要求 Azure Speech 订阅、Azure API Key 或在插件内配置付款账户，因此插件本身不会产生一项 Azure 账单。它实际调用的是 Microsoft Edge 的在线 Read Aloud 服务；微软可以调整服务条款、可用性、速率限制或访问策略，不能把它承诺为永久免费、无限量服务。微软官方将 Read Aloud 描述为 Edge 浏览器功能，使用时应遵守 [Microsoft Services Agreement](https://www.microsoft.com/en/servicesagreement)。

不要把 Edge Read Aloud 的免费可用性等同于 Azure Speech 的商业授权。Azure Speech 标准语音按字符计费；如果需要稳定的商业服务，应查看 [Azure Speech 定价](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) 和适用条款，或使用本地 Runtime。项目发布者不能替用户判断具体地区、账户或内容的授权。

Edge TTS 不能训练自己的声音。微软的 Custom Neural Voice / Personal Voice 属于 Azure Speech 的独立功能，需要申请 Limited Access；官方要求取得音色本人明确书面许可和录音确认，并按批准用途使用。Custom Neural Voice 的训练和托管也会计费，不能通过本插件完成。若 IndexTTS 或 GPT-SoVITS Runtime 支持本地音色训练/克隆，应遵守对应模型和录音许可；本插件只传递 Runtime 的 Voice ID，不保存或上传参考音频。

## 卸载

先停止朗读，然后运行：

```sh
dsh plugin --profile web remove @dsh-external/dsh-plugin-local-ai-tts
```

重启 Harness 并刷新页面。不会卸载或修改原版插件或任何 Runtime/模型。如需清理本插件主设置，卸载前点击 **恢复默认设置**；不会清除原版设置。

## 开发、测试与发布

```sh
npm run build
npm test
npm run test:adapter
npm pack --dry-run
```

测试只用 Node 内置模块、Python 标准库和 mock，无需安装新依赖、GPU、真实模型或云端 TTS。`src/local-client.js` 会嵌入 Harness 模块格式的 `lib/client.js`，两者都应提交。上游真实在线测试保留为手动选项，不进入 CI。

需要验证已有 HTTP Runtime 时，可运行 `npm run smoke:runtime -- --engine indextts --endpoint http://127.0.0.1:8765 --voice default`，自行替换参数；这只是旧版兼容路径。内置 Local Engine Launcher 的真实 worker 验证请按 [验证记录与人工清单](docs/VALIDATION.md) 配置现有 Python/模型环境执行；两者都**不等于 Harness 页面实际播放验收**。

发布前查看 [CHANGELOG](CHANGELOG.md)、[验证记录与人工清单](docs/VALIDATION.md)、[LICENSE](LICENSE)。npm 包使用文件白名单；`.gitignore` 和发布扫描排除模型、用户音色、参考录音、环境、凭据、音频产物。仍需人工审查最终 Git diff 与打包清单。GitHub 源码仓库已经可用；目前尚未声明 npm 包或稳定版 tag。

## 许可证

MIT，保留原作者版权及完整 LICENSE。没有新增生产依赖。[NOTICE](NOTICE.md)列出上游归属；Runtime、权重和音色的授权由各自项目/用户单独负责，插件 MIT 不代表获得这些内容的授权。
# 官方 WebUI 后端（无需打开网页）

默认的本地模式会按官方入口在后台加载模型，不需要手动打开模型网页：IndexTTS 2.5 使用项目中的 `webui.py`，GPT-SoVITS 使用官方 `GPT_SoVITS/inference_webui.py`（或明确选择的 fast 分支）。插件只负责启动参数、连接和逐句播放，模型加载与推理仍由官方代码完成。

如果探测到端口已有服务，插件不会猜测那是不是同一个项目或权重，而会提示先在高级设置选择“仅连接”。该模式不会启动、切换权重或停止用户自己的服务。目录发现不会执行 BAT，不会安装依赖，也不会下载模型；真正启动官方入口时，官方代码可能按自己的规则下载缺失资源、写缓存和输出文件。

IndexTTS 需要确认 2.5 模型目录和参考音频。GPT-SoVITS 需要参考音频、参考原文/语言，并在存在多个已保存模型组合时确认 `weight.json` 中的版本或权重。Gradio 接口会从实际服务的 `/config` 和 API 信息读取，插件不固定事件编号。
