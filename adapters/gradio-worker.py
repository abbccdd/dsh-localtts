"""Connect to, or start, a known official Gradio inference service.

No model classes are imported here. gradio_client comes from the user's
existing engine environment; this connector never installs dependencies.
"""
from __future__ import annotations

import argparse
import ast
import base64
from contextlib import redirect_stdout
from io import BytesIO
import inspect
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import quote, urlsplit, urlunsplit
import wave

# Embedded Python distributions may omit the script folder from sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from worker_common import OPENER, OwnedProcess, WorkerError, get_json, port_open, serve, wait_ready
from official_launch import build_launch, read_source


def endpoint_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or "\\" in value or any(ord(c) < 32 for c in value)):
        raise WorkerError("ENDPOINT", "WebUI address must be a loopback HTTP(S) URL without credentials or query.")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise WorkerError("ENDPOINT", "WebUI address has an invalid port.") from exc
    return urlunsplit((parsed.scheme, f"127.0.0.1:{port}", parsed.path.rstrip("/"), "", ""))


def resolve_endpoint(args):
    if args.endpoint:
        return endpoint_url(args.endpoint)
    if args.connection == "attach":
        raise WorkerError("ENDPOINT", "Enter the running inference WebUI address in Advanced.")
    root = Path(args.project_path)
    if args.engine == "indextts":
        for node in ast.walk(read_source(root / "webui.py")):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "add_argument":
                if any(isinstance(a, ast.Constant) and a.value == "--port" for a in node.args):
                    for kw in node.keywords:
                        if kw.arg == "default" and isinstance(kw.value, ast.Constant) and type(kw.value.value) is int:
                            return endpoint_url(f"http://127.0.0.1:{kw.value.value}")
    else:
        for node in read_source(root / "config.py").body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "webui_port_infer_tts" for t in node.targets):
                if isinstance(node.value, ast.Constant) and type(node.value.value) is int:
                    return endpoint_url(f"http://127.0.0.1:{node.value.value}")
    raise WorkerError("ENDPOINT", "Cannot safely infer the WebUI port. Enter its address in Advanced.")


def validate_config(config, endpoint):
    if not isinstance(config, dict) or not re.match(r"^[45]\.", str(config.get("version", ""))):
        raise WorkerError("GRADIO_VERSION", "This adapter supports Gradio 4 and 5 service schemas only.")
    if not str(config.get("protocol", "")).startswith("sse"):
        raise WorkerError("GRADIO_VERSION", "Unsupported Gradio queue protocol.")
    prefix = config.get("api_prefix", "")
    if prefix not in {"", "/gradio_api"}:
        raise WorkerError("SCHEMA", "Unrecognized Gradio API prefix.")
    root = config.get("root")
    if root and endpoint_url(root) != endpoint:
        raise WorkerError("SCHEMA", "Gradio root must match the selected local service address.")
    return config


def select_api(info, config, engine):
    matches = []
    for name, api in info.get("named_endpoints", {}).items():
        params = api.get("parameters", [])
        names = {p.get("parameter_name") for p in params}
        if engine == "indextts":
            valid = bool(re.fullmatch(r"/gen_single(?:_\d+)?", name)) and {"prompt", "text", "lang_choice", "emo_control_method"} <= names
        else:
            valid = ((bool(re.fullmatch(r"/(?:get_tts_wav|inference)(?:_\d+)?", name)) and {"ref_wav_path", "text", "prompt_text", "prompt_language", "text_language"} <= names)
                     or (bool(re.fullmatch(r"/inference(?:_\d+)?", name)) and {"text", "text_lang", "ref_audio_path", "prompt_text", "prompt_lang"} <= names))
        if not valid:
            continue
        deps = [d for d in config.get("dependencies", []) if d.get("api_name") == name.lstrip("/")]
        audio = [i for i, out in enumerate(api.get("returns", [])) if str(out.get("component", "")).lower() == "audio"]
        if len(deps) == 1 and len(audio) == 1:
            components = {c["id"]: c for c in config.get("components", [])}
            inputs = [i for i in deps[0].get("inputs", []) if str(components.get(i, {}).get("type", "")).lower() not in {"state", "tab", "row", "column"}]
            if len(inputs) == len(params):
                dep = {**deps[0], "inputs": inputs}
                matches.append((name, api, dep, audio[0]))
    if len(matches) != 1:
        names = ", ".join(str(n) + "(" + ",".join(str(p.get("parameter_name")) for p in a.get("parameters", [])) + ")" for n, a in info.get("named_endpoints", {}).items())
        detail = f" Available endpoints: {names[:500]}" if os.environ.get("DSH_TTS_DEBUG") == "1" else ""
        raise WorkerError("SCHEMA", "No unique supported synthesis API. GPT management pages are not inference services; unknown variants require an adapter." + detail)
    return matches[0]


# Keep the source file ASCII-safe on Windows while still matching the labels
# emitted by the official GPT-SoVITS WebUI.
LANGUAGES = {
    "zh": [chr(0x4e2d) + chr(0x6587), "Chinese", chr(0x4e2d) + chr(0x82f1) + chr(0x6df7) + chr(0x5408), "Chinese-English Mixed", "Chinese-English mixed"],
    "en": [chr(0x82f1) + chr(0x6587), "English"],
    "ja": [chr(0x65e5) + chr(0x82f1) + chr(0x6df7) + chr(0x5408), "Japanese-English Mixed", "Japanese-English mixed"],
    "all_zh": [chr(0x4e2d) + chr(0x6587), "Chinese"],
    "all_ja": [chr(0x65e5) + chr(0x6587), "Japanese"],
    "all_ko": [chr(0x97e9) + chr(0x6587), "Korean"],
    "all_yue": [chr(0x7ca4) + chr(0x8bed), "Cantonese"],
    "auto": [chr(0x591a) + chr(0x8bed) + chr(0x79cd) + chr(0x6df7) + chr(0x5408), "Multilingual Mixed", "Multilingual mixed"],
}


def choice_value(value, props, engine):
    choices = [v[1] if isinstance(v, (list, tuple)) and len(v) == 2 else v for v in props.get("choices", [])]
    if not choices:
        return value
    if value in choices:
        return value
    if engine == "indextts":
        aliases = [value.upper()]
    else:
        # The short keys are user-facing configuration values. Prefer one
        # deterministic canonical label before considering broader aliases;
        # for example ``zh`` must mean Chinese, not the separate mixed mode.
        canonical = {
            "zh": ["Chinese", chr(0x4e2d) + chr(0x6587)],
            "en": ["English", chr(0x82f1) + chr(0x6587)],
            "ja": ["Japanese", chr(0x65e5) + chr(0x6587), "Japanese-English Mixed"],
            "all_zh": ["Chinese", chr(0x4e2d) + chr(0x6587)],
            "all_ja": ["Japanese", chr(0x65e5) + chr(0x6587)],
            "all_ko": ["Korean", chr(0x97e9) + chr(0x6587)],
            "all_yue": ["Cantonese", chr(0x7ca4) + chr(0x8bed)],
            "auto": ["Multilingual Mixed"],
        }
        preferred = [candidate for candidate in canonical.get(value, []) if candidate in choices]
        if len(preferred) == 1:
            return preferred[0]
        aliases = LANGUAGES.get(value, [])
    matches = [v for v in choices if str(v).casefold() in {str(a).casefold() for a in aliases}]
    if len(matches) == 1:
        return matches[0]
    raise WorkerError("LANGUAGE", "Language is not available in this WebUI. Enter its exact language choice label in Advanced.")


def synthesis_inputs(selected, config, engine, text, reference, prompt_text, prompt_lang, text_lang,
                     duration_factor=1.0, speed_factor=1.0, handle_file=None, overrides=None):
    # Keep the helper's historical positional form compatible with external
    # checks: the ninth argument used to be handle_file.
    if handle_file is None and callable(duration_factor):
        handle_file, duration_factor = duration_factor, 1.0
    _, api, dep, _ = selected
    components = {c["id"]: c for c in config.get("components", [])}
    provided = {"text": text, "prompt": reference, "ref_wav_path": reference, "ref_audio_path": reference,
                "prompt_text": prompt_text, "prompt_language": prompt_lang, "prompt_lang": prompt_lang,
                "text_language": text_lang, "text_lang": text_lang, "lang_choice": text_lang,
                # Preserve the official model controls. IndexTTS calls this
                # duration_factor; GPT-SoVITS uses speed or speed_factor
                # depending on the selected official WebUI variant.
                "duration_factor": float(duration_factor), "speed": float(speed_factor),
                "speed_factor": float(speed_factor)}
    if handle_file is None:
        raise WorkerError("CLIENT_MISSING", "Gradio file handler is unavailable.")
    values = []
    for p, component_id in zip(api["parameters"], dep["inputs"]):
        name = p.get("parameter_name")
        component = components.get(component_id, {})
        props = component.get("props", {})
        if name in {"prompt", "ref_wav_path", "ref_audio_path"}:
            value = handle_file(reference)
        elif name in {"prompt_language", "prompt_lang", "text_language", "text_lang", "lang_choice"}:
            value = choice_value(provided[name], props, engine)
        elif overrides and name in overrides:
            value = overrides[name]
        elif name in provided:
            value = provided[name]
        elif name == "emo_control_method":
            # Explicitly use the selected reference voice; never reuse another
            # browser session's temporary emotion reference or state.
            choices = props.get("choices", [])
            first = choices[0] if choices else None
            value = first[1] if isinstance(first, (list, tuple)) else first
            if value is None:
                raise WorkerError("SCHEMA", "Missing IndexTTS reference-emotion choice.")
        elif name in {"emo_ref_path", "inp_refs", "aux_ref_audio_paths"}:
            value = None
        elif str(component.get("type", "")).lower() in {"audio", "file", "image", "video", "state"}:
            raise WorkerError("SCHEMA", "Unexpected file/state input in synthesis API.")
        elif p.get("parameter_has_default"):
            value = p.get("parameter_default")
        elif "value" in props:
            value = props["value"]
        else:
            raise WorkerError("SCHEMA", "Synthesis API has an unknown required parameter: " + str(name))
        values.append(value)
    return values


def fetch_audio_bytes(result, selected, endpoint, config):
    count = len(selected[1].get("returns", []))
    value = result[selected[3]] if count > 1 and isinstance(result, (tuple, list)) else result
    while isinstance(value, dict) and "value" in value:
        value = value["value"]
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if not isinstance(value, dict) or not isinstance(value.get("path"), str):
        raise WorkerError("BAD_AUDIO", "WebUI did not return a supported audio file.")
    # Never read a server-supplied absolute path on the Host or follow its URL.
    url = endpoint + config.get("api_prefix", "") + "/file=" + quote(value["path"], safe="/:\\")
    with OPENER.open(url, timeout=float(os.environ.get("DSH_TTS_REQUEST_SECONDS", "180"))) as response:
        data = response.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise WorkerError("BAD_AUDIO", "WebUI did not return a bounded WAV audio file.")
    return data


def encode_audio(data):
    return {"mime": "audio/wav", "audioBase64": base64.b64encode(data).decode("ascii")}


def wav_duration(data):
    try:
        with wave.open(BytesIO(data), "rb") as source:
            rate = source.getframerate()
            return source.getnframes() / rate if rate else None
    except (EOFError, wave.Error):
        return None


def spoken_character_count(text):
    return sum(unicodedata.category(ch)[0] in {"L", "N"} for ch in text)


def gpt_output_needs_retry(text, data):
    """Detect a short-prompt GPT runaway without interpreting speech text."""
    duration = wav_duration(data)
    spoken = spoken_character_count(text)
    return duration is not None and spoken > 0 and duration > max(6.0, spoken * 0.55 + 1.5)


def gpt_retry_is_preferable(text, first, retry):
    first_duration, retry_duration = wav_duration(first), wav_duration(retry)
    spoken = spoken_character_count(text)
    # A shorter file is not automatically better: reject near-empty/silent
    # retries before replacing the complete first result.
    minimum = max(0.5, spoken * 0.08)
    return (first_duration is not None and retry_duration is not None and
            retry_duration >= minimum and retry_duration < first_duration)


def fetch_audio(result, selected, endpoint, config):
    return encode_audio(fetch_audio_bytes(result, selected, endpoint, config))


def legacy_httpx(httpx, endpoint):
    """Keep the 0.14 client's requests local without changing installed HTTPX."""
    target = urlsplit(endpoint)
    seconds = float(os.environ.get("DSH_TTS_REQUEST_SECONDS", "180"))

    def check(url):
        value = urlsplit(str(url))
        if ((value.scheme, value.hostname, value.port) != (target.scheme, target.hostname, target.port)
                or value.username or value.password or value.fragment
                or not (value.path == target.path or value.path.startswith(target.path.rstrip('/') + '/'))):
            raise WorkerError("ENDPOINT", "Gradio client attempted a request outside the selected local service.")

    class LocalHTTP(httpx.Client):
        def __init__(self, *args, **kwargs):
            kwargs.update(trust_env=False, follow_redirects=False, timeout=seconds)
            super().__init__(*args, **kwargs)

        def send(self, request, **kwargs):
            check(request.url)
            kwargs["follow_redirects"] = False
            return super().send(request, **kwargs)

    class LocalAsyncHTTP(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs.update(trust_env=False, follow_redirects=False, timeout=seconds)
            super().__init__(*args, **kwargs)

        async def send(self, request, **kwargs):
            check(request.url)
            kwargs["follow_redirects"] = False
            return await super().send(request, **kwargs)

    class LocalModule:
        Client = LocalHTTP
        AsyncClient = LocalAsyncHTTP

        def __getattr__(self, name):
            original = getattr(httpx, name)
            if name not in {"get", "post", "put", "patch", "delete", "head", "options", "request", "stream"}:
                return original

            def call(*args, **kwargs):
                position = 1 if name in {"request", "stream"} else 0
                check(kwargs.get("url", args[position] if len(args) > position else ''))
                kwargs.update(trust_env=False, follow_redirects=False, timeout=seconds)
                return original(*args, **kwargs)
            return call

    return LocalModule()


def make_client(endpoint):
    os.environ.update(HF_HUB_DISABLE_TELEMETRY="1", GRADIO_ANALYTICS_ENABLED="False", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    try:
        import gradio_client
        from gradio_client import Client
    except ImportError as exc:
        raise WorkerError("CLIENT_MISSING", "gradio_client is unavailable. Select the Python environment already used by this engine.") from exc
    parameters = set(inspect.signature(Client).parameters)
    handle_file = getattr(gradio_client, 'handle_file', None) or getattr(gradio_client, 'file', None)
    if not {"download_files", "hf_token"} <= parameters or not callable(handle_file):
        raise WorkerError("CLIENT_VERSION", "This installed Gradio client lacks the required safe connection options.")
    options = dict(verbose=False, hf_token=False, download_files=False)
    if 'httpx_kwargs' in parameters:
        options['httpx_kwargs'] = {"trust_env": False, "follow_redirects": False,
                                  "timeout": float(os.environ.get("DSH_TTS_REQUEST_SECONDS", "180"))}
        if 'analytics_enabled' in parameters: options['analytics_enabled'] = False
    elif str(getattr(gradio_client, '__version__', '')).startswith('0.14.') and 'upload_files' in parameters:
        import httpx
        import gradio_client.client as client_module
        import gradio_client.utils as utils_module
        local_httpx = legacy_httpx(httpx, endpoint)
        # These module bindings exist only inside this connector process.
        # Explicit file() inputs avoid treating arbitrary strings as uploads.
        client_module.httpx = utils_module.httpx = local_httpx
        options['upload_files'] = False
    else:
        raise WorkerError("CLIENT_VERSION", "Unsupported installed Gradio client; expected 0.14.x or a client with httpx_kwargs.")

    class LocalClient(Client):
        def _get_config(self):
            return validate_config(get_json(endpoint + "/config"), endpoint)

        def close(self):
            if hasattr(super(), 'close'):
                super().close()
            else:
                self.executor.shutdown(wait=False, cancel_futures=True)

    client = LocalClient(endpoint, **options)
    return client, handle_file


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine", choices=["indextts", "gpt-sovits"], required=True)
    p.add_argument("--connection", choices=["auto", "attach"], default="auto")
    p.add_argument("--endpoint", default="")
    p.add_argument("--project-path", default="")
    p.add_argument("--model-dir", default="")
    p.add_argument("--variant", choices=["standard", "fast"], default="standard")
    p.add_argument("--gpt-version", default="")
    p.add_argument("--gpt-model", default="")
    p.add_argument("--sovits-model", default="")
    p.add_argument("--ref-audio", required=True)
    p.add_argument("--prompt-text", default="")
    p.add_argument("--prompt-lang", default="zh")
    p.add_argument("--text-lang", default="zh")
    p.add_argument("--duration-factor", type=float, default=1.0)
    p.add_argument("--speed-factor", type=float, default=1.0)
    args = p.parse_args()
    owned = OwnedProcess()
    client = None
    selected = None
    handle_file = None
    endpoint = None

    def ensure_ready():
        nonlocal client, selected, handle_file, endpoint
        owned.check()
        if client:
            return
        endpoint = resolve_endpoint(args)
        port = urlsplit(endpoint).port
        occupied = port_open(port)
        if occupied:
            if args.connection == "auto":
                raise WorkerError("EXTERNAL_SERVICE", "The detected WebUI port is already in use. Confirm its project/model, then choose Connection only in Advanced.")
        else:
            if args.connection == "attach":
                raise WorkerError("OFFLINE", "Inference WebUI is not running; connection-only mode does not start it.")
            if urlsplit(endpoint).scheme != "http" or urlsplit(endpoint).path:
                raise WorkerError("ENDPOINT", "Automatic startup needs a root HTTP loopback address.")
            command, cwd, env = build_launch(args, port)
            owned.start(command, cwd, env)
            wait_ready(lambda: get_json(endpoint + "/config"), owned, float(os.environ.get("DSH_TTS_STARTUP_SECONDS", "120")))
        # An occupied/wrong endpoint is never treated as permission to launch
        # a second model, pick another port, or switch existing model weights.
        validate_config(get_json(endpoint + "/config"), endpoint)
        with redirect_stdout(sys.stderr):
            candidate, candidate_handle = make_client(endpoint)
            try:
                info = candidate.view_api(print_info=False, return_format="dict")
                selected = select_api(info, candidate.config, args.engine)
            except Exception:
                candidate.close()
                raise
        client, handle_file = candidate, candidate_handle

    def handle(request):
        ensure_ready()
        if request.get("action") == "health":
            return {"ready": True, "status": "ready", "engine": args.engine,
                    "ownership": "owned" if owned.child else "external", "api": selected[0]}
        if request.get("action") == "voices":
            return {"voices": [{"id": args.ref_audio, "name": Path(args.ref_audio).name}]}
        if request.get("action") != "synthesize":
            raise WorkerError("ACTION", "Unknown worker action.")
        ref = Path(args.ref_audio).expanduser()
        if not ref.is_absolute() or str(ref).startswith(("\\\\", "//")) or not ref.is_file() or ref.stat().st_size > 32 * 1024 * 1024:
            raise WorkerError("REFERENCE", "Reference audio must be an existing local absolute file of at most 32 MiB.")
        text = str(request.get("text") or "").strip()
        if not text or len(text) > 70:
            raise WorkerError("TEXT", "Expected one nonempty sentence of at most 70 characters.")
        def synthesize_once(overrides=None):
            values = synthesis_inputs(selected, client.config, args.engine, text, str(ref.resolve()),
                                      args.prompt_text, args.prompt_lang, args.text_lang,
                                      args.duration_factor, args.speed_factor, handle_file, overrides)
            with redirect_stdout(sys.stderr):
                job = client.submit(*values, api_name=selected[0])
                result = job.result(timeout=float(os.environ.get("DSH_TTS_REQUEST_SECONDS", "180")))
                outputs = job.outputs()
                if outputs:
                    result = outputs[-1]
            return fetch_audio_bytes(result, selected, endpoint, client.config)

        audio = synthesize_once()
        retry_attempted = retry_applied = False
        if args.engine == "gpt-sovits" and gpt_output_needs_retry(text, audio):
            retry_attempted = True
            # Retry once through the WebUI's official sampling controls. Keep
            # the original result if the conservative sample is even longer.
            retry = synthesize_once({"top_k": 5, "top_p": 0.6, "temperature": 0.6,
                                     "repetition_penalty": 1.5})
            if gpt_retry_is_preferable(text, audio, retry):
                audio = retry
                retry_applied = True
        response = encode_audio(audio)
        response.update(retryAttempted=retry_attempted, retryApplied=retry_applied)
        return response

    def close():
        # Never send /control, change weights, or kill an external service.
        owned.close()

    try:
        serve(handle, close)
    finally:
        if client:
            client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
