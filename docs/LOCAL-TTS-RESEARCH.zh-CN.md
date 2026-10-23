# 个人电脑本地 TTS 接入调研

核对日期：2026-10-23。本文用于下一步适配设计，不表示下列引擎已经接入或经过本插件的真实模型测试。只讨论推理；训练和微调的资源需求另计。

## 优先覆盖的引擎

- **GPT-SoVITS v5dev / v5turbo**：作为本轮真实测试基准。官方代码已支持两个 v5 分支，共用 `s1v3.ckpt`，分别使用对应的 SoVITS 权重及 v5 vocoder。当前插件的官方启动器和角色发现只列出了 v1/v2/v3/v4/v2Pro/v2ProPlus，需要核实 v5 的启动参数和 Gradio 输入后才能扩展支持，不能只修改版本下拉框。来源：[官方代码](https://github.com/RVC-Boss/GPT-SoVITS)、[模型清单](https://huggingface.co/lj1995/GPT-SoVITS/tree/main)。
- **IndexTTS 2.5**：现有插件已接入的基准引擎，提供参考音频克隆、情绪、速度与发音控制。保留现有目录发现和启动方式。来源：[官方项目](https://github.com/index-tts/index-tts)。
- **CosyVoice 3 / 2**：优先考虑 0.5B 版本；中文、方言、跨语言克隆和流式能力适合对话朗读。官方 Python API、Gradio、FastAPI 是不同的接入面；官方 FastAPI 的克隆接口接收表单及音频上传，输出是原始 int16 PCM，不能当 WAV 直接播放。来源：[官方说明](https://github.com/FunAudioLLM/CosyVoice)、[FastAPI 源码](https://github.com/FunAudioLLM/CosyVoice/blob/main/runtime/python/fastapi/server.py)。
- **Qwen3-TTS**：0.6B 和 1.7B 系列。Base 用于参考音频克隆，CustomVoice 用于预设音色，VoiceDesign 用于描述声音；三种任务不能混为一个模型能力。官方 Python 接口分别为 `generate_voice_clone`、`generate_custom_voice`、`generate_voice_design`；也提供本地 Gradio 示例和 vLLM 部署说明。16GB 显卡可列为单模型短文本推理候选，实际占用、速度及 Windows 依赖尚需实测。来源：[官方说明](https://github.com/QwenLM/Qwen3-TTS)。
- **VoxCPM 2 / 1.5**：官方 README 列出的显存约为 8GB / 6GB，分别为 2B / 0.6B 主干；这不是本机测试结果。支持声音克隆，VoxCPM 2 还支持声音设计。Python、Gradio 与服务化部署的接口应分别验证。来源：[官方说明及版本对照](https://github.com/OpenBMB/VoxCPM#-models--versions)。
- **F5-TTS**：中英文参考音频克隆的候选。官方提供 Python、CLI 和 Gradio；参考音频原文为空时会调用 ASR，带来额外模型与资源需求，因此测试时优先显式提供原文。来源：[官方说明](https://github.com/SWivid/F5-TTS)。
- **Kokoro**：82M 轻量模型，支持中文等语言，适合预设音色朗读和较低资源占用。原版库不是通用 HTTP 服务；Kokoro-FastAPI 是独立部署项目，提供 OpenAI 兼容语音接口。来源：[模型库](https://github.com/hexgrad/kokoro)、[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)。
- **Piper**：轻量本地语音引擎，适合 CPU 常驻朗读。音质和语言取决于安装的 voice；普通使用流程是预训练音色，并非输入一段音频即可零样本克隆。当前官方 HTTP 文档使用 `POST /synthesize` 返回 WAV，并提供 `/info`；不要假定旧版路径仍相同。来源：[官方项目](https://github.com/OHF-Voice/piper1-gpl)、[HTTP 文档](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md)。
- **Chatterbox**：Multilingual V3 为 500M，包含中文等语言；Turbo 350M 和 Nano 110M 主要面向英文，Nano 提供 CPU 路线。作为多语言及英文测试候选，具体版本须独立标识。来源：[官方说明](https://github.com/resemble-ai/chatterbox)。

## 当前不下载的模型

**Fish Audio Drama 3**：按用户决定暂不下载。官方安装说明要求至少 48GB 显存（FP8）、Linux/WSL；不以网络上的第三方低显存改造替代官方模型验收。模型文件清单已查询，但没有启动权重下载。来源：[官方安装要求](https://github.com/fishaudio/fish-speech/blob/main/docs/en/install.md)、[官方模型](https://huggingface.co/fishaudio/drama-3)。

Fish Speech 的不同版本也不能共用一份未经验证的资源需求声明。当前官方 S2-Pro 说明至少 24GB，不能据此把整个 Fish Speech 系列归为 16GB 即可运行。

## 通用适配需要覆盖的边界

1. **模型身份与传输协议分离**：`model`、引擎名称、HTTP 协议不再绑定为同一个字段。主机切句、队列、停止和浏览器播放继续复用。
2. **OpenAI 兼容 HTTP**：覆盖已有兼容服务，明确 base URL 是否包含 `/v1`，允许模型名和附加参数；健康检查和音色列表为可选能力。协议兼容不等于任意原版模型项目都自带该服务。
3. **HTTP JSON**：覆盖例如 Piper 及已有 JSON 服务。动态文本作为 JSON 字段值编码，不能直接拼接进入 JSON 字符串。音频应明确是容器数据还是 PCM。
4. **表单与音频上传 / Gradio**：CosyVoice、F5 等原生接口需要参考音频、原文和特定输入顺序；不能靠一个通用 JSON 模板完整解决。使用逐引擎薄适配器，保留其版本差异。
5. **JSONL worker**：为没有兼容 HTTP 的 Python 引擎提供稳定边界，模型保持常驻，避免每一句启动一次 CLI、重新加载模型。
6. **音频归一化**：WAV/MP3 等容器由浏览器解码；PCM 必须有明确的采样率、声道数、位深，才能封装为 WAV；不把返回路径或下载 URL 当作音频本身。
7. **真实验收**：逐个记录环境、模型 revision、接口版本、参考音频、首句耗时、连续播放、停止后行为和内存。mock 通过、连接成功、真实合成成功、DSH 页面播放成功必须分别记录。

## 建议顺序

先完成 GPT-SoVITS v5 的依赖核对、真实合成和现有启动器兼容性检查；再完成通用 HTTP/worker 边界。新增模型优先 CosyVoice、Qwen3-TTS、VoxCPM 和 Kokoro/Piper，以覆盖参考音频克隆、预设音色及 CPU 朗读；F5、Chatterbox 随后补充。除已获授权的 GPT-SoVITS v5 外，本轮仅调研，不批量下载其他模型。
