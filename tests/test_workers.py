import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import asyncio

ADAPTERS = Path(__file__).parents[1] / "adapters"
sys.path.insert(0, str(ADAPTERS))
from worker_common import OwnedProcess, WorkerError, wait_ready
from official_launch import build_launch, saved_gpt_models, run_official
from voice_cache import load_matching_voice_cache

spec = importlib.util.spec_from_file_location("gradio_worker", ADAPTERS / "gradio-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def schema(engine="indextts", fast=False):
    names = (["emo_control_method", "prompt", "text", "lang_choice", "emo_ref_path", "duration_factor", "param_5"] if engine == "indextts"
             else ["text", "text_lang", "ref_audio_path", "prompt_text", "prompt_lang", "speed_factor"] if fast
             else ["ref_wav_path", "prompt_text", "prompt_language", "text", "text_language", "speed"])
    name = "/gen_single" if engine == "indextts" else "/inference" if fast else "/get_tts_wav"
    parameters, components = [], []
    for i, n in enumerate(names):
        props = {"value": 0.8}
        if n == "emo_control_method": props = {"choices": [["Reference", "Reference"]], "value": "Reference"}
        if "lang" in n: props = {"choices": [["ZH", "ZH"], ["EN", "EN"]]} if engine == "indextts" else {"choices": [["\u4e2d\u6587", "\u4e2d\u6587"], ["\u4e2d\u82f1\u6df7\u5408", "\u4e2d\u82f1\u6df7\u5408"], ["\u82f1\u6587", "\u82f1\u6587"]]}
        if engine != "indextts" and "lang" in n:
            props = {"choices": [["Chinese", "Chinese"], ["Chinese-English Mixed", "Chinese-English Mixed"], ["English", "English"]]}
        components.append({"id": i, "type": "number", "props": props})
        parameters.append({"parameter_name": n, "parameter_has_default": False})
    api = {"parameters": parameters, "returns": [{"component": "Audio"}] + ([{"component": "Number"}] if fast else [])}
    config = {"version": "5.45.0", "protocol": "sse_v3", "api_prefix": "/gradio_api", "components": components,
              "dependencies": [{"id": 72, "api_name": name[1:], "inputs": list(range(len(names)))}]}
    return {"named_endpoints": {name: api}}, config


class WorkerTests(unittest.TestCase):
    def test_legacy_client_transport_blocks_foreign_urls_proxies_and_redirects(self):
        calls = []

        class HTTP:
            def __init__(self, **kwargs): calls.append(kwargs)
            def send(self, request, **kwargs): calls.append(kwargs); return 'response'

        class AsyncHTTP(HTTP):
            async def send(self, request, **kwargs): return super().send(request, **kwargs)

        def request(*args, **kwargs): calls.append(kwargs); return 'response'
        module = SimpleNamespace(Client=HTTP, AsyncClient=AsyncHTTP, get=request, post=request, stream=request)
        safe = worker.legacy_httpx(module, 'http://127.0.0.1:9872')
        self.assertEqual(safe.get('http://127.0.0.1:9872/info?serialize=False', trust_env=True, follow_redirects=True), 'response')
        self.assertFalse(calls[-1]['trust_env']); self.assertFalse(calls[-1]['follow_redirects'])
        client = safe.Client(trust_env=True, follow_redirects=True)
        self.assertFalse(calls[-1]['trust_env']); self.assertFalse(calls[-1]['follow_redirects'])
        self.assertEqual(client.send(SimpleNamespace(url='http://127.0.0.1:9872/queue/join'), follow_redirects=True), 'response')
        self.assertFalse(calls[-1]['follow_redirects'])
        for url in ['http://example.com/upload', 'http://127.0.0.1:9999/info', 'http://user:pw@127.0.0.1:9872/info']:
            with self.subTest(url=url), self.assertRaises(WorkerError): safe.post(url)
            with self.subTest(url=url), self.assertRaises(WorkerError): client.send(SimpleNamespace(url=url))
        async_client = safe.AsyncClient()
        with self.assertRaises(WorkerError): asyncio.run(async_client.send(SimpleNamespace(url='https://example.com/')))
        self.assertIs(module.Client, HTTP)  # installed/global HTTPX is untouched

    def test_entrypoints_import_in_isolated_python_without_model_loading(self):
        # -I excludes the script directory, like Windows pythonXY._pth bundles.
        with tempfile.TemporaryDirectory() as directory:
            for filename in ['gradio-worker.py', 'gpt-sovits-worker.py', 'index-tts-worker.py', 'official_launch.py']:
                with self.subTest(filename=filename):
                    result = subprocess.run([sys.executable, '-I', str(ADAPTERS / filename), '--help'],
                                            cwd=directory, capture_output=True, text=True, timeout=10)
                    if filename == 'official_launch.py':
                        self.assertEqual(result.returncode, 1)
                        self.assertIn('must be launched by the local WebUI worker', result.stderr)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn('usage:', result.stdout)
                    self.assertNotIn('ModuleNotFoundError', result.stderr)

    def test_voice_cache_matches_gradio_copy_by_content_not_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompt = root / "prompt.wav"
            prompt.write_bytes(b"not-a-riff-but-the-original-bytes")
            cache = root / "voices" / "role" / "voice_cache"
            cache.mkdir(parents=True)
            digest = __import__("hashlib").sha256(prompt.read_bytes()).hexdigest()
            (cache / "cache.json").write_text(json.dumps({
                "speaker_sha256": digest, "emotion_sha256": digest,
            }))

            class Runtime:
                def __init__(self): self.loaded = []
                def is_voice_cache_valid(self, cache_dir, speaker, emotion, verify_file_hashes=True):
                    return Path(cache_dir) == cache and Path(speaker).read_bytes() == prompt.read_bytes()
                def load_voice_cache(self, cache_dir, spk_audio_prompt, emo_audio_prompt):
                    self.loaded.append((Path(cache_dir), spk_audio_prompt, emo_audio_prompt)); return True

            copied = root / "gradio-temp" / "prompt.wav"
            copied.parent.mkdir()
            copied.write_bytes(prompt.read_bytes())
            runtime = Runtime()
            self.assertTrue(load_matching_voice_cache(runtime, copied, root / "voices"))
            self.assertEqual(runtime.loaded[0][0], cache)
            self.assertEqual(runtime.loaded[0][1], str(copied))

    def test_voice_cache_mismatch_falls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); prompt = root / "prompt.wav"; prompt.write_bytes(b"current")
            cache = root / "role" / "voice_cache"; cache.mkdir(parents=True)
            (cache / "cache.json").write_text(json.dumps({"speaker_sha256": "old", "emotion_sha256": "old"}))
            class Runtime:
                def load_voice_cache(self, *args, **kwargs): raise AssertionError("must not load")
            self.assertFalse(load_matching_voice_cache(Runtime(), prompt, root))

    def test_endpoint_and_metadata_guards(self):
        self.assertEqual(worker.endpoint_url("http://localhost:9876/base/"), "http://127.0.0.1:9876/base")
        for url in ["http://example.com", "http://user:pass@127.0.0.1", "http://127.0.0.1/?token=x", "file:///tmp", "http://192.168.1.1"]:
            with self.subTest(url=url), self.assertRaises(WorkerError): worker.endpoint_url(url)
        _, config = schema()
        for changed in [{"version": "3.1"}, {"api_prefix": "https://example.com"}, {"root": "http://localhost:9999"}, {"protocol": "ws"}]:
            with self.subTest(changed=changed), self.assertRaises(WorkerError): worker.validate_config({**config, **changed}, "http://127.0.0.1:9876")

    def test_named_signature_mapping_for_both_gpt_variants_and_index(self):
        for engine, fast in [("indextts", False), ("gpt-sovits", False), ("gpt-sovits", True)]:
            with self.subTest(engine=engine, fast=fast):
                info, config = schema(engine, fast)
                selected = worker.select_api(info, config, engine)
                values = worker.synthesis_inputs(selected, config, engine, "hello", "/ref.wav", "reference", "zh", "zh",
                                                  duration_factor=1.25, speed_factor=1.4,
                                                  handle_file=lambda f: {"uploaded": f})
                self.assertIn({"uploaded": "/ref.wav"}, values)
                self.assertIn("hello", values)
                self.assertIn("ZH" if engine == "indextts" else "Chinese", values)
                self.assertIn(1.25 if engine == "indextts" else 1.4, values)
                # Event IDs and unrelated event order are immaterial.
                config["dependencies"].insert(0, {"id": 999, "api_name": "change_model", "inputs": []})
                self.assertEqual(worker.select_api(info, config, engine)[0], selected[0])

    def test_unknown_management_ambiguous_or_required_inputs_fail_closed(self):
        info, config = schema()
        with self.assertRaises(WorkerError): worker.select_api({"named_endpoints": {"/change_tts_inference": {}}}, config, "gpt-sovits")
        info["named_endpoints"]["/gen_single_1"] = info["named_endpoints"]["/gen_single"]
        config["dependencies"].append({**config["dependencies"][0], "api_name": "gen_single_1"})
        with self.assertRaises(WorkerError): worker.select_api(info, config, "indextts")
        info, config = schema()
        config["components"][-1]["props"] = {}
        with self.assertRaises(WorkerError):
            worker.synthesis_inputs(worker.select_api(info, config, "indextts"), config, "indextts", "text", "/ref", "", "zh", "zh", lambda x: x)

    def test_saved_models_are_not_guessed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ["gpt.ckpt", "sovits.pth"]: (root / name).write_bytes(b"fixture")
            with self.assertRaises(WorkerError): saved_gpt_models(root)
            data = {"GPT": {"v2": "gpt.ckpt"}, "SoVITS": {"v2": "sovits.pth"}}
            (root / "weight.json").write_text(json.dumps(data))
            version, gpt, sovits = saved_gpt_models(root)
            self.assertEqual(version, "v2"); self.assertTrue(Path(gpt).is_file()); self.assertTrue(Path(sovits).is_file())
            data["GPT"]["v3"] = "gpt.ckpt"; data["SoVITS"]["v3"] = "sovits.pth"
            (root / "weight.json").write_text(json.dumps(data))
            with self.assertRaises(WorkerError): saved_gpt_models(root)
            self.assertEqual(saved_gpt_models(root, "v3")[0], "v3")

    def test_launch_recipe_and_port_inspection_do_not_execute_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "models").mkdir(); (root / "models/config.yaml").write_text("version: 2.5")
            source = "raise RuntimeError('must not execute')\ndef gen_single(): pass\nparser.add_argument('--port', default=9234)\nflags=['--version','--model_dir','--host']\n"
            (root / "webui.py").write_text(source)
            args = argparse.Namespace(engine="indextts", endpoint="", connection="auto", project_path=directory, model_dir=str(root / "models"), variant="standard")
            self.assertEqual(worker.resolve_endpoint(args), "http://127.0.0.1:9234")
            command, cwd, env = build_launch(args, 9234)
            self.assertEqual(cwd, directory); self.assertIn("--version", command); self.assertIn("2.5", command)
            self.assertEqual(env["GRADIO_ANALYTICS_ENABLED"], "False")
            self.assertEqual((root / "webui.py").read_text(), source)

    def test_guard_only_changes_serving_options(self):
        calls = []
        class Blocks:
            def launch(self, *args, **kwargs): calls.append(kwargs)
        fake = argparse.Namespace(Blocks=Blocks)
        original_argv, original_path = sys.argv[:], sys.path[:]
        try:
            with patch.dict(sys.modules, {"gradio": fake}), patch("official_launch.runpy.run_path", side_effect=lambda *a, **k: Blocks().launch(inbrowser=True, share=True, server_name="0.0.0.0", server_port=1)):
                run_official("/fixture/webui.py", 9345, ["--version", "2.5"])
            self.assertEqual(calls, [{"inbrowser": False, "share": False, "server_name": "127.0.0.1", "server_port": 9345}])
        finally: sys.argv, sys.path = original_argv, original_path

    def test_readiness_waits_retries_and_times_out(self):
        owned = OwnedProcess(); count = 0
        def probe():
            nonlocal count
            count += 1
            return count >= 3
        self.assertTrue(wait_ready(probe, owned, 1)); self.assertEqual(count, 3)
        with self.assertRaisesRegex(WorkerError, "timeout"): wait_ready(lambda: False, owned, 0.01)
        owned.close()
        with self.assertRaises(WorkerError): wait_ready(lambda: True, owned, 1)

    def test_gpt_api_waits_for_http_readiness_and_eof_reaps_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
            script = root / "api_v2.py"
            script.write_text("""import argparse, json, time
from http.server import HTTPServer, BaseHTTPRequestHandler
p=argparse.ArgumentParser(); p.add_argument('--bind_addr'); p.add_argument('--port',type=int); a=p.parse_args()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({'paths':{'/tts':{}}}).encode())
time.sleep(0.7)
HTTPServer((a.bind_addr,a.port),Handler).serve_forever()
""")
            proc = subprocess.Popen([sys.executable, str(ADAPTERS / "gpt-sovits-worker.py"), "--api-script", str(script), "--project-path", directory, "--port", str(port), "--ref-audio", "fixture.wav"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
            try:
                started = time.monotonic()
                proc.stdin.write(json.dumps({"id": "health", "action": "health"}) + "\n"); proc.stdin.flush()
                reply = json.loads(proc.stdout.readline())
                self.assertTrue(reply.get("ready"), reply); self.assertGreaterEqual(time.monotonic() - started, 0.65)
                proc.stdin.close(); proc.wait(timeout=5)
                with socket.socket() as s: self.assertNotEqual(s.connect_ex(("127.0.0.1", port)), 0)
            finally:
                if not proc.stdin.closed: proc.stdin.close()
                if proc.poll() is None: proc.kill(); proc.wait(timeout=5)
                proc.stdout.close(); proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
