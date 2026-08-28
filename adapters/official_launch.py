"""Build a bounded launch recipe from known official source layouts.

This module never imports model code during discovery. The child executes the
existing official script; only Gradio browser/share/bind options are guarded.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import runpy
import sys

# The helper is also executed directly by isolated/embedded Python installs.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from worker_common import WorkerError
from voice_cache import load_matching_voice_cache


def read_source(file):
    if not file.is_file() or file.stat().st_size > 256 * 1024:
        raise WorkerError("ENTRY", "Official entry is missing or exceeds the source inspection limit.")
    return ast.parse(file.read_text(encoding="utf-8-sig"))


def local_file(value, root):
    if not isinstance(value, str) or not value or value.startswith(("\\\\", "//")) or "://" in value:
        raise WorkerError("MODEL_SELECTION", "Select an existing local model file; model aliases are not auto-selected.")
    file = Path(value).expanduser()
    file = (file if file.is_absolute() else root / file).resolve()
    if not file.is_file():
        raise WorkerError("MODEL_SELECTION", "Selected model file does not exist on the Harness Host.")
    return str(file)


def saved_gpt_models(root, version="", gpt="", sovits=""):
    data = {}
    file = root / "weight.json"
    if file.is_file():
        if file.stat().st_size > 65536:
            raise WorkerError("MODEL_SELECTION", "weight.json exceeds the inspection limit.")
        data = json.loads(file.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict) or not isinstance(data.get("GPT", {}), dict) or not isinstance(data.get("SoVITS", {}), dict):
        raise WorkerError("MODEL_SELECTION", "Unrecognized weight.json layout. Select the model pair explicitly.")
    versions = set(data.get("GPT", {})) & set(data.get("SoVITS", {}))
    if not version:
        if len(versions) != 1:
            raise WorkerError("MODEL_SELECTION", "Choose a GPT model version in Advanced; no unique saved model pair was found.")
        version = next(iter(versions))
    if version not in {"v1", "v2", "v3", "v4", "v2Pro", "v2ProPlus"}:
        raise WorkerError("MODEL_SELECTION", "Unsupported GPT model version. Use connection-only mode for this installation.")
    def single(value):
        if isinstance(value, list):
            if len(value) != 1:
                raise WorkerError("MODEL_SELECTION", "Several saved weights exist. Select one model pair in Advanced.")
            return value[0]
        return value
    return version, local_file(single(gpt or data.get("GPT", {}).get(version)), root), local_file(single(sovits or data.get("SoVITS", {}).get(version)), root)


def build_launch(args, port):
    root = Path(args.project_path).resolve()
    if not root.is_dir() or str(root).startswith(("\\\\", "//")) or root == Path(root.anchor):
        raise WorkerError("PROJECT_PATH", "Select a local engine project folder.")
    relative = "webui.py" if args.engine == "indextts" else "GPT_SoVITS/inference_webui" + ("_fast" if args.variant == "fast" else "") + ".py"
    entry = (root / relative).resolve()
    if root not in entry.parents:
        raise WorkerError("ENTRY", "Official entry must stay inside the selected project.")
    tree = read_source(entry)
    functions = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    expected = "gen_single" if args.engine == "indextts" else ("inference" if args.variant == "fast" else "get_tts_wav")
    if expected not in functions:
        raise WorkerError("ENTRY", "Unrecognized WebUI entry. Use connection-only mode or the existing worker.")
    env = os.environ.copy()
    env.update(PYTHONUTF8="1", GRADIO_ANALYTICS_ENABLED="False", HF_HUB_DISABLE_TELEMETRY="1")
    if args.engine == "indextts":
        constants = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        if not {"--version", "--model_dir", "--host", "--port"} <= constants:
            raise WorkerError("ENTRY", "This IndexTTS launcher does not expose the supported 2.5 options.")
        if not args.model_dir or not (Path(args.model_dir) / "config.yaml").is_file():
            raise WorkerError("MODEL_PATH", "Select the existing IndexTTS 2.5 model directory.")
        script_args = ["--version", "2.5", "--model_dir", str(Path(args.model_dir).resolve()), "--host", "127.0.0.1", "--port", str(port)]
    else:
        version, gpt, sovits = saved_gpt_models(root, args.gpt_version, args.gpt_model, args.sovits_model)
        # Do not inherit an unrelated manager's model/precision selection.
        for key in ["gpt_path", "sovits_path", "version", "is_half", "_CUDA_VISIBLE_DEVICES", "bert_path", "cnhubert_base_path"]:
            env.pop(key, None)
        env.update(version=version, gpt_path=gpt, sovits_path=sovits, infer_ttswebui=str(port), is_share="False")
        # Use explicitly saved literal manager settings without executing config.py.
        config = root / "config.py"
        if config.is_file():
            for node in read_source(config).body:
                if not isinstance(node, ast.Assign):
                    continue
                for target in node.targets:
                    if not isinstance(target, ast.Name):
                        continue
                    key = {"bert_path": "bert_path", "cnhubert_path": "cnhubert_base_path", "is_half": "is_half"}.get(target.id)
                    if key:
                        try:
                            value = ast.literal_eval(node.value)
                        except (ValueError, TypeError):
                            continue
                        if isinstance(value, (str, bool)):
                            env[key] = str(value)
        script_args = ["zh_CN"]
    command = [sys.executable, "-u", str(Path(__file__).resolve()), "--run", str(entry), str(port), *script_args]
    return command, str(root), env


def run_official(entry, port, script_args):
    import gradio as gr
    original_launch = gr.Blocks.launch

    def launch(blocks, *args, **kwargs):
        # Official GPT scripts explicitly request inbrowser=True and public
        # bind. Guard only serving options, not model loading/inference.
        kwargs.update(inbrowser=False, share=False, server_name="127.0.0.1", server_port=int(port))
        return original_launch(blocks, *args, **kwargs)

    gr.Blocks.launch = launch
    sys.path.insert(0, str(Path(entry).parent))
    sys.path.insert(1, os.getcwd())
    # The official IndexTTS WebUI passes the Gradio temporary reference path
    # straight to ``tts.infer``.  If that file is a mislabeled container but a
    # verified persistent cache exists for the same bytes, load the cache
    # before the official inference code attempts to decode it.  No model code
    # is changed; installations without these optional cache methods retain
    # the upstream behavior.
    if Path(entry).name.casefold() == "webui.py":
        try:
            import indextts.infer_v2_5 as infer_module
            cls = getattr(infer_module, "IndexTTS2", None)
            original_infer = getattr(cls, "infer", None)
            if cls is not None and original_infer is not None and not getattr(original_infer, "_dsh_voice_cache_patch", False):
                cache_root = Path(entry).parent / "outputs" / "presets"

                def infer_with_cache(self, *args, **kwargs):
                    prompt = kwargs.get("spk_audio_prompt")
                    if prompt is None and args:
                        prompt = args[0]
                    load_matching_voice_cache(self, prompt, cache_root)
                    return original_infer(self, *args, **kwargs)

                infer_with_cache._dsh_voice_cache_patch = True
                cls.infer = infer_with_cache
        except Exception as exc:
            # This hook is optional; the official process will surface its
            # ordinary import or reference-audio error if it cannot be used.
            print(f">> Voice cache hook unavailable: {exc}", file=sys.stderr, flush=True)
    sys.argv = [entry, *script_args]
    runpy.run_path(entry, run_name="__main__")


if __name__ == "__main__":
    if len(sys.argv) < 4 or sys.argv[1] != "--run":
        raise SystemExit("This helper must be launched by the local WebUI worker.")
    run_official(sys.argv[2], sys.argv[3], sys.argv[4:])
