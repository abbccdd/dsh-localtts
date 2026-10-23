# 个人电脑模型追加实测

2026-10-23，Windows、RTX 5060 Ti 16GB、复用已有 PyTorch 2.8.0+cu128。测试代码、模型、环境位于插件源码之外，未放入插件安装包。

**2026-10-24 追加：** 以上模型现已增加[文件夹直接加载入口](MODEL-FOLDERS.zh-CN.md)，并通过五模型直接 SDK 合成和正式 DSH 页面控制验收，无需先启动下文的 HTTP 测试网关。下文保留 10 月 23 日的通用协议测试方法和结果。

## 已完成

- Kokoro 0.9.4 / Kokoro-82M / zf_xiaobei 中文音色。
- F5-TTS 1.1.17 / F5TTS_v1_Base / Vocos，使用已有参考音频及匹配原文。
- VoxCPM 1.5.0 / VoxCPM1.5，参考音频克隆，关闭额外降噪模型和 torch.compile。
- Qwen3-TTS 0.1.1 / 12Hz-0.6B-CustomVoice / Vivian，BF16、SDPA。
- CosyVoice 3 / Fun-CosyVoice3-0.5B-2512，参考音频克隆；主体 CUDA，Windows 现有 ONNX Runtime 的语音 tokenizer 使用 CPU。

每套均经真实插件 `createProvider` 完成健康检查、音色列表、两句中文合成，并在正式 DSH 设置页通过同一个通用入口完成连接和试听播放。共保存 10 个 WAV；每套的请求记录和 DSH 播放截图分别留存。所有输出都检查有限值、非零波形、采样率和时长。

本机测试服务将各 SDK 统一包装为 OpenAI speech 接口，DSH 只需配置服务地址、模型和音色，没有增加逐模型 Provider。这不能代替对各项目所有原生 API/WebUI 版本的验证。

## 数值范围及限制

短句预热/缓存后的记录：Kokoro 两句约 0.27s/0.12s；F5 第二句约 0.89s；VoxCPM 两句约 2.92s/3.38s。Qwen 前两句约 25.59s/13.86s，之后设置页短句约 5.83s。CosyVoice 前两句约 34.30s/26.74s，之后设置页短句约 3.58s。

输入长度、声学步数、精度、初始化及缓存不同；这些是连通性测试记录，不是统一条件的性能排名。未装 FlashAttention、TensorRT 或新增训练功能。播放状态和波形检查不代表人耳对音质、漏字和音色相似度的评价。

模型下载固定官方 Hugging Face revision；通过 ModelScope 传输的大文件仍按官方哈希核对，44 个文件的最终审计通过。测试环境通过 `.pth` 只读复用原有 IndexTTS 依赖；不同版本依赖装在各自环境，原 IndexTTS 未覆盖。CosyVoice 的旧构建依赖和缺失包已按具体报错修复。

## 本地使用

开发者本机工作目录提供统一 `start-candidate.ps1 -Engine <名称>` 启动器、`CANDIDATE-USAGE.zh-CN.md` 配置指南、每套配置 JSON、官方下载清单和音频。这些测试工具、录音和环境不随插件安装包分发；普通用户需自行启动兼容的本地 HTTP 服务或 JSONL worker。开发者测试每次只启动一套，默认端口 5080；切换前停止旧服务。测试结束保留 CosyVoice 供本机试听，其他新增测试进程已停止。

Drama 3 和 Fish S2-Pro 未下载，也未计入通过名单。
