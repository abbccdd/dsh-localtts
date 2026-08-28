import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

spec = importlib.util.spec_from_file_location("facade", Path(__file__).parents[1] / "adapters/python_http.py")
facade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(facade)


class PCM:
    dtype = "int16"
    ndim = 1

    def astype(self, kind, copy):
        assert kind == "<i2" and copy is False
        return self

    def tobytes(self):
        return b"\0\0" * 20


class Runtime:
    def __init__(self):
        self.calls = []

    def list_voices(self):
        return ["other"]

    def load_voice(self, voice):
        self.calls.append(("voice", voice))

    def synthesize(self, **kwargs):
        self.calls.append(kwargs)
        return 22050, PCM()


class HttpAdapterTests(unittest.TestCase):
    def test_existing_object_only_both_engines(self):
        for engine in ("indextts", "gpt-sovits"):
            with self.subTest(engine=engine):
                runtime = Runtime()
                server = facade.make_server(runtime, engine=engine, port=0)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                endpoint = f"http://127.0.0.1:{server.server_port}"
                opener = build_opener(ProxyHandler({}))

                def call(path, data=None, extra=None):
                    request = Request(endpoint + path, data=json.dumps(data).encode() if data else None,
                                      headers={"Content-Type": "application/json", **(extra or {})})
                    with opener.open(request, timeout=2) as response:
                        return json.load(response)

                try:
                    self.assertEqual(call("/health")["engine"], engine)
                    self.assertEqual(call("/voices")["voices"], ["other"])
                    audio = call("/synthesize", {"text": "测试。", "engine": engine, "voice": "other"})
                    self.assertEqual(audio["sample_rate"], 22050)
                    self.assertEqual(runtime.calls, [("voice", "other"), {"text": "测试。"}])
                    with self.assertRaises(HTTPError) as error:
                        call("/health", extra={"Origin": "https://evil.test"})
                    self.assertEqual(error.exception.code, 403)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
