"""Optional HTTP facade for an ALREADY CREATED Runtime object; no model imports.

In the existing Runtime owner process, call make_server(runtime, engine=...,
port=...).serve_forever(). Model initialization remains the owner's job.
"""
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def make_server(runtime, *, engine, port, host="127.0.0.1"):
    if engine not in {"indextts", "gpt-sovits"}:
        raise ValueError("Unsupported engine")
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("HTTP facade only binds to loopback")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log request bodies, voice paths or assistant replies.

        def reply(self, status, data):
            body = json.dumps(data).encode("utf-8")
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # HTTP cancellation cannot interrupt an in-progress GPU kernel.

        def allowed(self):
            # Server-side plugin requests have no Origin. Reject direct web pages.
            if self.headers.get("Origin") or self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.reply(403, {"error": "Browser-origin requests are not supported"})
                return False
            if self.headers.get("Host", "").split(":")[0] not in {"localhost", "127.0.0.1"}:
                self.reply(403, {"error": "Invalid Host"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == "/health":
                self.reply(200, {"status": "busy" if lock.locked() else "ready", "engine": engine})
            elif self.path == "/voices":
                if not hasattr(runtime, "list_voices"):
                    self.reply(404, {"error": "Voice discovery unavailable"})
                    return
                try:
                    self.reply(200, {"voices": runtime.list_voices()})
                except Exception:
                    self.reply(500, {"error": "Voice discovery failed"})
            else:
                self.reply(404, {"error": "Unknown route"})

        def do_POST(self):
            if not self.allowed():
                return
            if self.path != "/synthesize":
                self.reply(404, {"error": "Unknown route"})
                return
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                self.reply(415, {"error": "Use application/json"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 8192:
                    raise ValueError()
                self.connection.settimeout(5)
                request = json.loads(self.rfile.read(size))
                text, voice = request["text"], request.get("voice", "default")
                if request.get("engine") != engine or not isinstance(text, str) or not text.strip() or len(text) > 70:
                    raise ValueError()
                if not isinstance(voice, str) or not voice or len(voice) > 256:
                    raise ValueError()
            except Exception:
                self.reply(400, {"error": "Invalid synthesis request"})
                return
            if not lock.acquire(blocking=False):
                self.reply(429, {"error": "Runtime busy"})
                return
            try:
                # default means the already loaded voice. Explicit IDs must be listed.
                if voice != "default":
                    if voice not in runtime.list_voices():
                        self.reply(400, {"error": "Unknown voice ID"})
                        return
                    runtime.load_voice(voice)
                rate, pcm = runtime.synthesize(text=text)
                if str(pcm.dtype) != "int16" or pcm.ndim != 1:
                    raise ValueError("Expected mono int16 PCM")
                # No resampling, inference overrides, output paths, or model loading.
                raw = pcm.astype("<i2", copy=False).tobytes()
                self.reply(200, {"format": "s16le", "sample_rate": rate, "channels": 1,
                                 "pcm_base64": base64.b64encode(raw).decode("ascii")})
            except Exception:
                self.reply(500, {"error": "Synthesis failed; inspect Runtime locally"})
            finally:
                lock.release()

    return ThreadingHTTPServer((host, port), Handler)
