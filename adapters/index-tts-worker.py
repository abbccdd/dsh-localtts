"""JSONL worker for an existing IndexTTS 2.5 installation.

This file is a connector only. It imports the user's existing runtime class,
keeps the model in memory, and never downloads or changes checkpoints.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import tempfile
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_cache import load_matching_voice_cache


def reply(request_id, **payload):
    print(json.dumps({"id": request_id, **payload}, ensure_ascii=False), flush=True)


def parser():
    p = argparse.ArgumentParser()
    p.add_argument("--project-path", required=True, help="Existing IndexTTS project directory")
    p.add_argument("--model-dir", required=True)
    p.add_argument("--presets-root")
    p.add_argument("--device")
    p.add_argument("--voice", default="default")
    p.add_argument("--lang", default="ZH")
    p.add_argument("--duration-factor", type=float, default=1.0)
    p.add_argument("--bf16", action="store_true")
    return p


def wav_bytes(sample_rate, samples):
    raw = samples.astype("int16", copy=False).tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(int(sample_rate))
        f.writeframes(raw)
    return out.getvalue()


def main():
    args = parser().parse_args()
    project = str(Path(args.project_path).expanduser().resolve())
    sys.path.insert(0, project)
    try:
        from indextts.infer_v2_5 import IndexTTS2
        cfg_path = str(Path(args.model_dir) / "config.yaml")
        runtime = IndexTTS2(cfg_path=cfg_path, model_dir=args.model_dir,
                            use_bf16=args.bf16,
                            device=args.device or None,
                            use_deepspeed=False, use_cuda_kernel=False)
        current_voice = args.voice
        cache_root = (
            Path(args.presets_root).expanduser()
            if args.presets_root
            else Path(project) / "outputs" / "presets"
        )
    except Exception as exc:
        print(f"IndexTTS worker initialization failed: {exc}", file=sys.stderr, flush=True)
        return 2

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id")
            action = request.get("action")
            if action == "health":
                reply(request_id, ok=True, ready=True, status="ready", engine="indextts")
            elif action == "voices":
                voices = []
                root = Path(args.presets_root).expanduser() if args.presets_root else None
                if root and root.is_dir():
                    voices = [{"id": str(p.resolve()), "name": p.stem} for p in sorted(root.glob("*.wav"))]
                if not voices:
                    voices = [{"id": current_voice or args.voice, "name": current_voice or args.voice}]
                reply(request_id, ok=True, voices=voices)
            elif action == "synthesize":
                text = str(request.get("text") or "").strip()
                voice = str(request.get("voice") or current_voice or args.voice)
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out:
                    output_path = out.name
                try:
                    # Reuse a verified persistent cache when available.  This
                    # also handles Gradio-exported files whose bytes are not a
                    # decoder-readable WAV despite their .wav suffix.
                    load_matching_voice_cache(runtime, voice, cache_root)
                    runtime.infer(spk_audio_prompt=voice, text=text, lang=args.lang,
                                  duration_factor=args.duration_factor,
                                  output_path=output_path, verbose=False)
                    encoded = base64.b64encode(Path(output_path).read_bytes()).decode("ascii")
                finally:
                    Path(output_path).unlink(missing_ok=True)
                reply(request_id, ok=True, mime="audio/wav", audioBase64=encoded)
            else:
                reply(request_id, ok=False, code="ACTION", error="Unknown worker action")
        except Exception as exc:
            reply(request.get("id") if isinstance(request, dict) else None,
                  ok=False, code="SYNTHESIS", error=str(exc)[:500])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
