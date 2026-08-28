# 引擎目录识别 / Engine directory discovery

## 用户需要配置什么

正常安装只需选择引擎、粘贴项目文件夹、确认参考音频。主界面不要求填写 Python、启动脚本、模型目录或各个权重文件；这些仍是运行所需文件，但由 Host 自动定位，必要时在高级设置覆盖。不会删除用户安装中的任何文件。

| 内容 | IndexTTS 2.5 | GPT-SoVITS | 是否需要手填 |
| --- | --- | --- | --- |
| 项目目录 | 包含 `indextts/infer_v2_5.py` | 同时包含根目录 `api_v2.py` 和 `GPT_SoVITS/` | 是，或提供支持的外层目录 |
| Python 环境 | 现有环境 | 现有环境，整合包常用 `runtime/python.exe` | 通常自动；缺失/多候选时指定 |
| 推理配置 | 模型目录中的 `config.yaml` | `GPT_SoVITS/configs/tts_infer.yaml` | 通常自动；自定义位置时覆盖 |
| 模型权重 | 由所选模型目录及配置解析 | 由现有推理 YAML 及引擎代码解析 | 不逐个填写；自定义模型需准备匹配的已有 YAML |
| 参考音频 | 克隆目标音色的音频 | 对应模型/音色的参考音频 | 一个候选自动填，多候选选择，未找到则手填 |
| 原文和语言 | 主界面选择 `ZH/EN/JA/AR/ES`；IndexTTS 使用 `lang_choice` 和 `duration_factor` | 主界面选择输出语言与 `speed`/`speed_factor`；`prompt_text`、`prompt_lang` 在高级设置 | 输出语言和模型语速可直接选择；GPT 参考原文/语言是否必需取决于模型 |
| 端口 | 不需要 HTTP 端口 | 默认 `9880`，仅绑定 loopback | 仅冲突时改高级项 |
| 超时、设备、Debug | 保留现有默认值 | 保留现有默认值 | 可选高级项 |

“只填文件夹”可以定位启动依赖，但不能推断用户想使用哪个音色、哪个并存的 Python 环境或自定义模型。空白 Python 高级项保留 PATH 中 `python` 的旧行为；找不到本地环境时会提示，不能保证 PATH 环境已安装依赖。

## Host 的限定查找规则

- 输入必须是可访问的本地绝对目录；拒绝磁盘根目录、UNC/网络路径、相对路径。支持粘贴带双引号的路径。
- 优先检查输入目录本身，否则只检查固定一层子目录：`app`、`index-tts`、`IndexTTS`、`IndexTTS2.5`、`GPT-SoVITS`。存在多个有效项目时要求用户指定具体项目。
- 在已识别项目及用户提供的外层目录内查找 `.venv/Scripts/python.exe`、`venv/Scripts/python.exe`、`env/Scripts/python.exe`、`runtime/python.exe`、`python/python.exe` 和 `.venv/bin/python`、`venv/bin/python`、`env/bin/python`。不遍历系统 Conda 环境；解析到选择目录外的符号链接不自动采用，可手动指定解释器。
- IndexTTS 检查 `checkpoints/config.yaml`、`checkpoints_25/config.yaml`、`models/IndexTTS-2.5/config.yaml`，最多读取每份配置前 64 KiB 的版本字段。明确不是 2.5 的配置跳过；未声明版本的配置提示待确认。
- GPT-SoVITS 自动采用根目录 `api_v2.py` 和默认位置的 `tts_infer.yaml`。不猜测任意 `.pth` / `.ckpt` 的用途，不改写 YAML。
- 音频查找项目根目录的直接文件，并检查 `examples`、`voices`、`ref_audios`、`refer_audios`、`reference_audio`、`reference_audios`、`outputs/presets`，每个目录向下最多两层。识别 `.wav`、`.mp3`、`.flac`、`.ogg`、`.m4a`；实际格式支持取决于引擎及其音频依赖。
- 单次音频枚举最多 1500 个目录项、100 个候选。不会遍历其他 `outputs` 内容、任意深层目录或跨出选择范围的链接，不读取音频内容或权重。

返回值标记 `layoutOnly: true`：文件结构存在不等于模型完整、依赖兼容、显存够用或真实合成成功。发现不会执行 Python、启动批处理/WebUI、安装依赖或下载模型；实际运行由用户的引擎代码负责，其行为仍需按该项目管理。

## GPT-SoVITS 本地角色配置

除普通参考音频目录外，GPT 模式检查 `runtime_voices/<角色>/` 的参考音频，以及该目录直接包含的 `voice.json`。后者是可选的本地运行时格式，不是官方 WebUI 的通用角色预设。支持 `format_version: 1`，要求 `model_version`、`gpt_checkpoint`、`sovits_checkpoint`、`reference_audio`、`prompt_text`、`prompt_lang` 有效；名称来自 `name` 或角色目录名。

两份权重按项目根目录解析，参考音频按角色目录解析；文件必须存在且实际路径不能超出相应目录。每份 JSON 最多读取 64 KiB，与音频枚举共享 1500 个目录项上限，最多返回 100 个角色。不执行脚本、不读取权重内容、不加载 `conditioning.pt` 缓存。不支持、损坏或文件缺失的配置会提示并跳过，不会从其他训练轮次猜一对权重。

在官方 WebUI 连接方式下，主界面显示“角色（已保存的本地配置）”。用户选择后，一次性填入 GPT / SoVITS 模型组合、版本、参考音频、原文和参考语言；合成语言和语速保留原设置。重扫不会覆盖手动修改。权重只用于启动新后台，**仅连接模式不会切换已有 WebUI 的模型**；独立 API 模式仍以其 YAML 决定模型。

`weight.json` 没有完整模型组合与“没有参考音频”分别提示。选择包含完整信息的本地角色可以提供启动所需组合，无须修改模型项目的 `weight.json`。

Saved local GPT characters under `runtime_voices/<character>/voice.json` (format v1) can fill an explicitly chosen checkpoint pair, model version, reference, transcript and reference language together. This is optional local-runtime compatibility, not an official universal preset or tensor-cache loader. Paths and metadata are bounded and validated; existing attached WebUI weights are never switched.

## 状态与兼容

- 自动查找走同源 Host 路由，不需要先创建朗读会话，不上传参考音频。
- 单一候选填入空白项，多个候选不擅自选择；重扫保留已有手动路径。
- 更换项目/引擎清除旧启动路径和参考音频/原文，保留通用超时等设置。慢响应不会覆盖后来的项目、引擎、手动编辑或设置重置。
- 引擎和 Provider 一起保存；GPT-SoVITS 的参考音频选择同步到 worker 配置。
- 不完整的新配置会停用 Host 上一份自动朗读配置，避免继续用旧引擎合成。
- 已保存的自定义 worker/HTTP 配置仍保留；改变项目目录后使用内置启动方式。

## 官方启动依据

### 官方 WebUI 后台模式

高级设置中的“官方 WebUI 后端（无需打开网页）”有两种行为：

- **复用或后台启动**：项目目录和入口可识别时，插件启动官方 Python WebUI 后端，并把 `inbrowser`、分享和监听地址限制为 `False`、`False`、`127.0.0.1`。不会打开浏览器，不会执行 BAT，不会修改上游源文件。模型加载和推理函数仍由用户项目的官方入口执行。
- **仅连接**：用户确认已有推理 WebUI 的地址和模型后，插件只连接它；不会启动、切换权重或发送 `/control` 停止命令。

自动模式发现的端口只来自入口文件中的字面量配置：IndexTTS 的 `webui.py --port` 默认值，或 GPT-SoVITS 的 `config.py` 中 `webui_port_infer_tts`。如果该端口已有插件无法证明身份的服务，自动模式会停止并要求用户选择“仅连接”，避免把别的项目或模型当成目标。端口识别不执行 Python、BAT 或 YAML。

IndexTTS 要求入口包含官方 2.5 参数和 `gen_single`；GPT-SoVITS 要求 `inference_webui.py` 的 `get_tts_wav`，或 `inference_webui_fast.py` 的 `inference`。入口版本、Gradio 参数和返回音频仍须在实际安装中通过连接测试确认。GPT 的模型组合来自该项目已保存的 `weight.json`；有多个版本或多个权重时必须在高级设置确认，插件不会擅自调用网页中的模型切换事件。

官方 IndexTTS 原版的预设加载只把 `prompt_audio` 路径填回音频控件，不等于加载 `voice_cache`。插件启动官方 WebUI 后，会在 `tts.infer` 前按参考文件 SHA-256 查找并通过模型自身的完整性校验加载对应 `voice_cache`；Gradio 临时复制后的路径也能按内容命中。命中时跳过 `librosa`/`soundfile` 的参考音频读取，未命中时保持官方读取流程。`.wav` 扩展名不会把 MP4/ISO 内容转换成 WAV；因此没有匹配缓存的同类文件仍会失败。缓存复用属于插件启动适配层增强，外部“仅连接”且未预先加载缓存的 WebUI 不会被插件注入。

官方入口可能下载缺失模型/配置、创建缓存和输出目录。这是官方启动行为，插件只负责启动由自己拥有的子进程并在退出时回收；用户自行启动的服务不会被插件杀掉。

Windows 整合包的 `pythonXY._pth` 可能不包含脚本所在目录。插件入口会显式加入自身适配器目录，不需要用户编辑整合包 Python 配置。现有 Gradio 客户端 0.14.x 通过兼容分支调用其 `file()` 和队列接口；所有客户端请求限制在选定的本地服务，禁用环境代理、重定向、遥测及自动结果下载。较新的客户端继续使用其 `httpx_kwargs` 接口。这不代表支持任意第三方修改版；连接与模型加载仍需实际检查。

IndexTTS 2.5 使用现有 Python 环境导入 `indextts.infer_v2_5.IndexTTS2`，传入模型目录与 `config.yaml`，合成时提供参考音频。见 [官方 IndexTTS README](https://github.com/index-tts/index-tts#python-api) 和 [2.5 推理实现](https://github.com/index-tts/index-tts/blob/main/indextts/infer_v2_5.py)。插件直接使用附带的 JSONL worker，不要求用户启动 WebUI。

GPT-SoVITS 使用 `python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml` 对应的现有 API 启动方式，再向 `/tts` 传入文本、语言和参考音频等信息。启动参数及原文约束以安装版本为准，见 [官方 api_v2.py](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/api_v2.py) 和 [官方推理配置](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/GPT_SoVITS/configs/tts_infer.yaml)。识别布局不承诺支持所有第三方整合包和模型版本。

## English summary

Only engine, project folder and reference audio are main settings. Known Python, script and configuration paths are detected within a bounded local tree. Ambiguous candidates require user selection; missing/external paths can be overridden under collapsed Advanced settings. A GPT-SoVITS reference transcript may still be required by the selected model. Discovery is read-only and does not prove runtime readiness. Existing manual overrides survive rescans; switching projects/engines clears stale paths and invalidates late responses. See the official sources above and the main README for the setup flow.

When the plugin starts an IndexTTS WebUI, it can reuse a verified 2.5 voice cache by reference-file SHA-256 before the official inference function decodes audio. This supports Gradio temporary copies and preserves the official path when no matching cache exists; attach-only external services are not modified.
