"""JSONL connector for the stock GPT-SoVITS api_v2.py process."""
from __future__ import annotations

import argparse
import base64
import os
import sys
import urllib.request
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from worker_common import OPENER, OwnedProcess, WorkerError, get_json, port_open, serve, wait_ready


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api-script", required=True)
    p.add_argument("--project-path")
    p.add_argument("--tts-config")
    p.add_argument("--port", type=int, default=9880)
    p.add_argument("--ref-audio", required=True)
    p.add_argument("--prompt-text", default="")
    p.add_argument("--prompt-lang", default="zh")
    p.add_argument("--text-lang", default="zh")
    p.add_argument("--speed-factor", type=float, default=1.0)
    p.add_argument("--python", dest="python_exe", default=sys.executable)
    args = p.parse_args()
    owned = OwnedProcess()
    ready = False
    base = f"http://127.0.0.1:{args.port}"

    def ensure_ready():
        nonlocal ready
        owned.check()
        if ready:
            return
        if port_open(args.port):
            raise WorkerError("PORT_IN_USE", "API port is occupied. Choose another port or use WebUI connection mode.")
        command = [args.python_exe, args.api_script, "--bind_addr", "127.0.0.1", "--port", str(args.port)]
        if args.tts_config:
            command.extend(["--tts_config", args.tts_config])
        owned.start(command, args.project_path or None)
        # api_v2 constructs TTS before serving this schema; process liveness is insufficient.
        wait_ready(lambda: "/tts" in get_json(base + "/openapi.json").get("paths", {}),
                   owned, float(os.environ.get("DSH_TTS_STARTUP_SECONDS", "120")))
        ready = True

    def handle(request):
        ensure_ready()
        action = request.get("action")
        if action == "health":
            return {"ready": True, "status": "ready", "engine": "gpt-sovits"}
        if action == "voices":
            return {"voices": [{"id": args.ref_audio, "name": args.ref_audio}]}
        if action != "synthesize":
            raise WorkerError("ACTION", "Unknown worker action.")
        payload = {"text": str(request.get("text") or ""), "text_lang": args.text_lang,
                   "ref_audio_path": args.ref_audio, "prompt_lang": args.prompt_lang,
                   "prompt_text": args.prompt_text, "speed_factor": args.speed_factor,
                   "media_type": "wav", "streaming_mode": False}
        req = urllib.request.Request(base + "/tts", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with OPENER.open(req, timeout=float(os.environ.get("DSH_TTS_REQUEST_SECONDS", "180"))) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise WorkerError("BAD_AUDIO", "Official API did not return a bounded WAV audio file.")
        return {"mime": "audio/wav", "audioBase64": base64.b64encode(data).decode("ascii")}

    serve(handle, owned.close)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
