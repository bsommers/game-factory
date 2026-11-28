import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from factory_client import Client, FactoryError, codes


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json"):
        raw = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        got = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/kits.list":
            self._send(200, json.dumps({"ok": True, "data": {"echo": got}, "error": None, "next": ["a"]}))
        elif self.path == "/api/styles.show":
            self._send(404, json.dumps({"ok": False, "data": None, "error": {"code": "NOT_FOUND", "message": "no"}, "next": []}))
        else:
            self._send(502, "<html>")


class UnitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Mock)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.c = Client(f"http://127.0.0.1:{cls.srv.server_port}", timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_ok_envelope_drops_none(self):
        env = self.c.kits_list()
        self.assertTrue(env.ok)
        self.assertEqual(env.next, ["a"])
        self.assertEqual(env.data["echo"], {})

    def test_error_code(self):
        with self.assertRaises(FactoryError) as cm:
            self.c.styles_show(id="x")
        self.assertEqual((cm.exception.code, cm.exception.status), (codes.NOT_FOUND, 404))

    def test_bad_response_and_transport(self):
        with self.assertRaises(FactoryError) as cm:
            self.c.call("x.y")
        self.assertEqual(cm.exception.code, codes.BAD_RESPONSE)
        with self.assertRaises(FactoryError) as cm:
            Client("http://127.0.0.1:1", timeout=1).capabilities()
        self.assertEqual(cm.exception.code, codes.TRANSPORT)


@unittest.skipUnless(os.environ.get("FACTORY_URL"), "FACTORY_URL not set (start `bin/factory serve --port 0` and export it)")
class SmokeLive(unittest.TestCase):
    def test_live_server(self):
        c = Client(os.environ["FACTORY_URL"])
        self.assertTrue(c.capabilities().ok)
        env = c.kits_list()
        self.assertTrue(env.ok and isinstance(env.data["kits"], list))
        with self.assertRaises(FactoryError) as cm:
            c.call("nope.nothing")
        self.assertEqual((cm.exception.code, cm.exception.status), (codes.UNKNOWN_CAPABILITY, 404))
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(c.swarm_track(project=d, agent="py-smoke", state="start", message="hello").ok)
            ev = next(c.events(d))
            self.assertEqual(ev.name, "progress")


if __name__ == "__main__":
    unittest.main()
