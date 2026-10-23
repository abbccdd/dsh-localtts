# 通用本地 TTS

在插件的 Provider 中选择 **通用本地 TTS（HTTP / worker）**，或在本地设置的“引擎”中选择“通用本地 TTS”。原有 IndexTTS / GPT-SoVITS 启动方式继续保留。

## HTTP 服务

先启动自己的本地 TTS 服务，然后填写基础地址。选择预设会填入接口默认值；请按服务实际端口修改。预设都是同一个 HTTP Provider 的配置数据，不会安装或启动对应模型。

- **OpenAI speech / LocalAI / Kokoro-FastAPI**：填写模型 ID、音色 ID，默认路由 `/v1/audio/speech`。基础地址可以包含 `/v1`，不会重复拼接。高级设置可添加 `speed`、`instructions` 等 JSON 参数；句子、模型、音色、WAV 格式和关闭流式的字段由连接器统一填写。
- **自定义 HTTP**：指定合成路由、JSON / URL 编码表单 / multipart 编码及请求体模板。使用完整字段值 `{{text}}`、`{{voice}}`、`{{model}}`，支持 JSON 嵌套；不会把文本直接拼接进 JSON 源码。
- **Piper**：当前接口为 `/synthesize`，`/info` 检查服务可访问，`/voices` 列出本地音色。只有一个音色时，测试连接会填入该音色。旧版 `/` 合成接口使用单独的路由预设。
- **Fish Speech / GPT-SoVITS API**：提供 JSON 接口模板，仍需在模型服务端准备音色或参考音频。GPT API 模板中的 `ref_audio_path`、`prompt_text` 必须按现有音频填写。这些预设不代表所有历史版本都已实测。

表单字段只接受标量。multipart 的“音频上传”填写 JSON 映射，例如 `{"prompt_wav":"/absolute/path/reference.wav"}`；Windows 路径建议使用正斜杠。文件属于 Harness Host，最多 3 个，每个不超过 16MiB，只接受有可识别文件头的 WAV/MP3/FLAC/Ogg。JSON 中的音频路径则属于 TTS 服务，不会自动上传。

## 音频与连接检查

默认接收 WAV、MP3、Ogg、FLAC；能根据容器文件头纠正部分服务的错误 Content-Type。JSON 音频可填点分隔的 base64 字段路径，如 `data.audio`。原有 s16le PCM JSON envelope 继续可用。

对于 CosyVoice 等返回裸 PCM 的服务，选择 **裸 PCM（s16le）**，按服务实际输出填写采样率和声道数。不要把 WAV 选择成裸 PCM。连接器不猜采样率、不重新采样，也不自动下载响应里的文件路径/URL。

健康检查与音色列表可留空。`JSON 就绪状态`读取 ready/status；`仅检查 HTTP 可访问`只说明服务可访问，不说明模型已加载。未配置健康检查时不会伪造在线状态。请用 **试听** 检查真实合成，再开启自动朗读。

需要 Bearer 鉴权时，在 Host 环境中设置密钥，只在设置里填写环境变量名（如 `LOCAL_TTS_API_KEY`），然后重启 Host 使其继承环境。浏览器设置和日志不保存密钥值，不读取 Harness 的认证数据。默认仅 loopback；私有 LAN IPv4 需要明确勾选，公网主机仍被拒绝。请求不经过环境 HTTP 代理、不跟随重定向。

## 没有 HTTP 接口的引擎

选择 **JSONL worker 进程**，填写实现 [worker 协议](PROCESS-WORKER-PROTOCOL.md) 的可执行程序、每行一个启动参数及工作目录。使用参数数组直接启动，不经过 shell。通用 worker 的 engine 标识为 `generic`，实际模型由 worker 自己的启动参数确定。普通 CLI/WebUI 命令不会自动变成 JSONL worker。

配置按引擎分别保存，切换回来恢复原配置。改变连接参数会停止旧播放并使旧配置失效。手动朗读、自动切句、暂停、停止、预取上限和共存保护使用原有链路。

## 支持边界

这是按协议接入，不是读取任意模型文件的统一推理框架。提供上述 HTTP 接口的模型可直接配置；只有 Gradio 页面、专用 WebSocket、异步任务轮询或特殊音频协议的项目，仍需服务自身提供桥接，或使用 JSONL 薄适配器。尚未宣称每个主流引擎的所有版本均通过真实模型测试。

“OpenAI speech”指接口格式，连接的仍是设置中指定的本机服务，不要求 OpenAI 账号或云服务。插件不强制要求统一网关。Piper、GPT-SoVITS 已验证原生 HTTP 接口；Kokoro、F5-TTS、VoxCPM、Qwen3-TTS、CosyVoice 的此次验证经过开发者本机 SDK 网关，网关代码和模型环境不随插件分发，不能据此推断其全部原生接口已验证。详见[模型实测记录](CANDIDATE-VALIDATION.zh-CN.md)。

开发验证：`npm test` 包含通用 HTTP / worker 边界测试；`npm run test:adapter` 检查原有 Python 适配器。插件无新增生产依赖；本地测试模型和 Python 环境独立于安装包。
