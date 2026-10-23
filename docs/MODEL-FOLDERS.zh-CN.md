# 本地模型文件夹

文件夹入口直接通过插件自带的 JSONL worker 调用已安装的本地 SDK，无需启动 HTTP 网关。通用 HTTP、OpenAI 兼容接口、自定义 JSONL、IndexTTS 和 GPT-SoVITS 原有入口继续保留。

## 使用

1. 在语音提供者中选择“本地模型文件夹（自动识别）”。
2. 点击“选择文件夹”，浏览运行 DSH 的电脑上的模型目录；也可粘贴完整路径。
3. 点击“识别文件夹”。允许直接选择模型目录，或包含模型的上一级目录；多个模型会显示选择列表。
4. 选择预设音色，或填写参考音频及其原文。点击“加载模型”，就绪后点击“试听”。
5. 需要释放模型占用时点击“卸载模型”。这也会关闭自动朗读；普通“停止朗读”只停止播放，保留已加载模型。

设置跟随插件的中英文语言选择，中文为中文界面。设置自动保存到当前浏览器，刷新后仍保留；其他浏览器有独立配置。

## 已知模型布局

- Kokoro 82M：`config.json`、`kokoro-v1_0.pth`、`voices/*.pt`。音色列表来自本地音色文件；音色前缀决定 Kokoro 语言。
- Qwen3-TTS CustomVoice：`config.json` 声明 `qwen3_tts` / `custom_voice`，以及 `model.safetensors` 和完整 tokenizer。音色来自配置和 SDK 的 supported speakers。Base / VoiceDesign 不会误识别为 CustomVoice。
- F5-TTS v1 Base：`model_1250000.safetensors`、`vocab.txt`，另需本地 Vocos 文件夹，内含 `config.yaml` 和 `pytorch_model.bin`。
- VoxCPM：`config.json` 声明 `architecture: voxcpm`，以及 `model.safetensors`、`audiovae.pth` 和 tokenizer。
- CosyVoice 3：`cosyvoice3.yaml`、`flow.pt`、`llm.pt`，以及官方完整模型配套文件；需已有 CosyVoice 源码和 Matcha-TTS 子模块。

文件夹识别只读取目录和小型 JSON，不运行项目代码、不反序列化权重，也不代表依赖已经可用。不支持的模型请使用通用协议入口；单个未知权重文件无法推断完整推理架构。

## 环境和音色

自动查找模型附近的 `.venv`、`venv`、`<类型>-runtime` 中的 Python；F5 还查找附近 `vocos-model`，CosyVoice 查找附近 `CosyVoice` 源码。未识别完整时，在“环境设置”填写已有路径。不会安装依赖或下载模型。worker 启用 Hugging Face 离线模式；前端音素、tokenizer 等辅助资源也必须事先准备。

F5、VoxCPM 和 CosyVoice 需要参考音频及对应原文。填写一次后可保存音色预设，再从“已保存音色”复用。预设存在浏览器设置内，参考音频仍保留在原位置。相同名称再次保存会更新预设。

也可在模型目录放入 `dsh-voices.json`，用于分发已有参考音色；音频路径必须在该模型目录内：

```json
{
  "voices": [
    { "id": "speaker", "name": "我的音色", "referenceAudio": "references/speaker.wav", "promptText": "参考音频中的原文。" }
  ]
}
```

所有模型共用进程管理、串行合成队列、播放、暂停和停止逻辑。模型 SDK 的导入和推理差异集中在一个 worker 的加载配方中；增加新模型不需要新增播放 Provider。SDK 版本差异仍可能需要更新配方，不能保证任意第三方改版权重都能加载。

## 故障排查

- “请指定 Python”：填写该模型实际安装依赖的环境中的 Python，不要直接选择系统中另一个 Python。
- “缺少模型依赖”：使用已有的对应环境；识别出 Python 文件并不保证该环境装有模型 SDK。
- 首次加载较慢：等待加载结果，冷启动可能需数分钟；启动超时可在环境设置中调整。
- 音色不存在：确认 Kokoro 的 `voices` 文件完整，或 Qwen 使用 CustomVoice 模型。
- 停止后显存仍占用：停止朗读保留模型，使用“卸载模型”释放插件持有的进程；其他会话共享的同配置模型在最后一个会话释放后退出。
- 本版语速选项只对 Kokoro、F5 和 CosyVoice 显示；Qwen / VoxCPM 不伪造 SDK 没有支持的语速参数。

此功能不包含模型、参考音频、Python 环境或第三方 SDK 的分发。

## 2026-10-24 本机验收

在 Windows / RTX 5060 Ti 16GB 上，以上五个模型均通过新文件夹 worker 的直接加载、音色查询和两句真实合成，共 10 份非空 WAV；本次未经过 OpenAI HTTP 网关。

随后在正式 DSH 中文设置页逐个完成加载、试听、暂停、继续、停止和卸载。Qwen 显示 9 个预设音色；F5 保存的参考音色在 VoxCPM 和 CosyVoice 中复用。另验证加载中断后的 Windows Python 进程树回收。CosyVoice 的 PyTorch 主体在 CUDA 运行，当前已安装环境中的 ONNX 前端使用 CPU。

这些结果只覆盖本机已下载的官方模型布局与已有 SDK 环境，不代表同名模型的所有版本或任意第三方整合包均兼容。旧的网关验证记录仍保留在[候选模型测试记录](CANDIDATE-VALIDATION.zh-CN.md)中，属于此前的通用协议验证。
