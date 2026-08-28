"""Standard-library lifecycle helpers for plugin-owned child processes."""
from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import traceback
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler


class WorkerError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise WorkerError("REDIRECT", "Local service redirects are not allowed.")


OPENER = build_opener(ProxyHandler({}), NoRedirect())


def get_json(url, timeout=2):
    with OPENER.open(url, timeout=timeout) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise WorkerError("TOO_LARGE", "Service metadata exceeds the size limit.")
        return json.loads(raw)


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except ConnectionRefusedError:
        return False
    except (TimeoutError, socket.timeout):
        # Windows can time out instead of promptly refusing a closed local
        # port. Only a successful exclusive bind establishes that it is free.
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                if os.name == "nt":
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                probe.bind(("127.0.0.1", port))
                return False
        except OSError as exc:
            if exc.errno in {98, 10048}:
                return True
            raise WorkerError("PORT_CHECK", "Could not establish that the local service port is free.") from exc
    except OSError as exc:
        raise WorkerError("PORT_CHECK", "Could not safely check the local service port.") from exc


class OwnedProcess:
    def __init__(self):
        self.child = None
        self.closed = threading.Event()
        self.lock = threading.Lock()

    def start(self, command, cwd, env=None):
        with self.lock:
            if self.closed.is_set():
                raise WorkerError("CANCELLED", "Worker is closing.")
            self.child = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                          stdout=sys.stderr, stderr=sys.stderr,
                                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return self.child

    def check(self):
        if self.closed.is_set():
            raise WorkerError("CANCELLED", "Worker is closing.")
        if self.child and self.child.poll() is not None:
            raise WorkerError("ENGINE_EXIT", "Official engine process exited. Check its dependencies and model files.")

    def close(self):
        self.closed.set()
        with self.lock:
            child = self.child
            if child and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=2)


def wait_ready(probe, owned, timeout):
    deadline = time.monotonic() + timeout
    while True:
        owned.check()
        try:
            value = probe()
            if value:
                owned.check()
                return value
        except WorkerError:
            raise
        except (OSError, ValueError):
            pass
        if time.monotonic() >= deadline:
            raise WorkerError("START_TIMEOUT", "Official service did not become ready before the startup timeout.")
        owned.closed.wait(min(0.2, max(0, deadline - time.monotonic())))


def serve(handler, shutdown):
    """Watch EOF even while model loading/inference blocks the handler."""
    requests = queue.Queue(maxsize=64)

    def read_stdin():
        try:
            for line in sys.stdin:
                if len(line) > 65536:
                    break
                requests.put(line)
        finally:
            shutdown()
            requests.put(None)

    threading.Thread(target=read_stdin, daemon=True).start()
    try:
        while True:
            line = requests.get()
            if line is None:
                break
            request = None
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise WorkerError("REQUEST", "Expected a JSON object.")
                result = {"id": request.get("id"), "ok": True, **handler(request)}
            except Exception as exc:
                if os.environ.get("DSH_TTS_DEBUG") == "1":
                    traceback.print_exc(file=sys.stderr)
                result = {"id": request.get("id") if isinstance(request, dict) else None, "ok": False,
                          "code": getattr(exc, "code", "SYNTHESIS"),
                          "error": str(exc)[:500] if isinstance(exc, WorkerError) else "Local engine request failed. Check the engine environment and inputs."}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    finally:
        shutdown()
