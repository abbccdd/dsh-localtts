"""Safe reuse of persisted IndexTTS 2.5 reference caches.

The cache is optional.  A cache is accepted only when the model runtime's own
integrity checks confirm that every tensor and both reference fingerprints
match the submitted file.  If anything is missing or invalid, callers keep
the official audio loading path unchanged.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def _sha256_file(path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_matching_voice_cache(runtime, prompt, cache_root, logger=print):
    """Load the cache whose reference fingerprint matches *prompt*.

    ``prompt`` may be a Gradio temporary copy: matching by content rather than
    path is intentional.  Returns ``True`` only after the runtime has accepted
    and loaded the complete cache.
    """
    if not prompt or not hasattr(runtime, "load_voice_cache"):
        return False
    try:
        path = Path(prompt)
        if not path.is_file():
            return False
        if path.stat().st_size > 32 * 1024 * 1024:
            return False
        digest = _sha256_file(path)
        root = Path(cache_root) if cache_root else None
        if root is None or not root.is_dir():
            return False
        for meta_path in root.glob("*/voice_cache/cache.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if meta.get("speaker_sha256") != digest or meta.get("emotion_sha256") != digest:
                continue
            cache_dir = meta_path.parent
            try:
                valid = runtime.is_voice_cache_valid(
                    cache_dir,
                    str(path),
                    str(path),
                    verify_file_hashes=True,
                )
            except Exception:
                valid = False
            if not valid:
                continue
            try:
                loaded = runtime.load_voice_cache(
                    cache_dir,
                    spk_audio_prompt=str(path),
                    emo_audio_prompt=str(path),
                )
            except Exception as exc:
                logger(f">> Voice cache rejected: {exc}")
                continue
            if loaded:
                logger(f">> Voice cache reused: {cache_dir}")
                return True
    except Exception as exc:
        # Cache reuse is an optimization and must never prevent the official
        # runtime from reporting its normal reference-audio error.
        logger(f">> Voice cache lookup skipped: {exc}")
    return False
