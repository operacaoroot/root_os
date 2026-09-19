import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError

from client import HttpTransport, MAX_WIRE_BYTES, TransportError


class Response:
    status = 200

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.body


class HangingResponse(Response):
    def read(self, limit):
        raise TimeoutError("synthetic body timeout")


class Opener:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error

    def open(self, request, timeout):
        if self.error:
            raise self.error
        return self.response


class TransportTests(unittest.TestCase):
    def test_https_required_and_http_test_is_loopback_only(self):
        with self.assertRaises(TransportError):
            HttpTransport("http://localhost:1234")
        with self.assertRaises(TransportError):
            HttpTransport("http://127.0.0.1:1234")
        self.assertEqual(HttpTransport("http://127.0.0.1:1234", allow_http_test=True).base_url,
                         "http://127.0.0.1:1234")
        with self.assertRaises(TransportError):
            HttpTransport("ftp://127.0.0.1:1234")

    def test_redirect_timeout_and_invalid_json_are_sanitized(self):
        redirect = HTTPError("https://connector.synthetic", 302, "redirect", {}, None)
        with self.assertRaisesRegex(TransportError, "servidor recusou"):
            HttpTransport("https://connector.synthetic", opener=Opener(error=redirect)).post("/x", {})
        with self.assertRaisesRegex(TransportError, "não foi possível"):
            HttpTransport("https://connector.synthetic", opener=Opener(error=TimeoutError())).post("/x", {})
        with self.assertRaisesRegex(TransportError, "resposta inválida"):
            HttpTransport("https://connector.synthetic", opener=Opener(Response(b"{marker-secret"))).post("/x", {})

    def test_real_loopback_redirect_is_not_followed_and_never_sends_bearer_to_target(self):
        seen = {"first": [], "second": []}

        class SecondHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                seen["second"].append(self.headers.get("Authorization"))
                self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
            def log_message(self, *_args):
                pass

        second = ThreadingHTTPServer(("127.0.0.1", 0), SecondHandler)
        second_thread = threading.Thread(target=second.serve_forever, daemon=True); second_thread.start()
        location = f"http://127.0.0.1:{second.server_port}/target"

        class FirstHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                seen["first"].append(self.headers.get("Authorization"))
                self.send_response(302); self.send_header("Location", location); self.end_headers()
            def log_message(self, *_args):
                pass

        first = ThreadingHTTPServer(("127.0.0.1", 0), FirstHandler)
        first_thread = threading.Thread(target=first.serve_forever, daemon=True); first_thread.start()
        try:
            transport = HttpTransport(f"http://127.0.0.1:{first.server_port}", token="synthetic", allow_http_test=True)
            with self.assertRaises(TransportError):
                transport.post("/start", {})
            self.assertEqual(seen["first"], ["Bearer synthetic"])
            self.assertEqual(seen["second"], [])
        finally:
            first.shutdown(); second.shutdown(); first.server_close(); second.server_close()

    def test_invalid_tls_certificate_is_rejected_without_body_or_secret(self):
        error = ssl.SSLCertVerificationError("synthetic invalid certificate marker")
        with self.assertRaisesRegex(TransportError, "não foi possível") as raised:
            HttpTransport("https://connector.synthetic", token="synthetic-secret", opener=Opener(error=error)).post("/x", {})
        self.assertNotIn("synthetic", str(raised.exception))

    @unittest.skipUnless(shutil.which("openssl"), "openssl não disponível")
    def test_real_loopback_self_signed_certificate_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            cert = f"{directory}/cert.pem"; key = f"{directory}/key.pem"
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=wrong.synthetic", "-keyout", key, "-out", cert,
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            class Handler(BaseHTTPRequestHandler):
                def do_POST(self):
                    self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
                def log_message(self, *_args):
                    pass

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                with self.assertRaisesRegex(TransportError, "não foi possível"):
                    HttpTransport(f"https://127.0.0.1:{server.server_port}", token="synthetic-secret").post("/x", {})
            finally:
                server.shutdown(); server.server_close()

    def test_wire_response_limit_is_closed(self):
        body = b"x" * (MAX_WIRE_BYTES + 1)
        with self.assertRaisesRegex(TransportError, "teto de wire"):
            HttpTransport("https://connector.synthetic", opener=Opener(Response(body))).post("/x", {})

    def test_timeout_while_consuming_response_body_is_sanitized(self):
        with self.assertRaisesRegex(TransportError, "não foi possível"):
            HttpTransport("https://connector.synthetic", opener=Opener(HangingResponse(b""))).post("/x", {})

    def test_json_response_is_dict_only(self):
        with self.assertRaises(TransportError):
            HttpTransport("https://connector.synthetic", opener=Opener(Response(json.dumps([1]).encode()))).post("/x", {})


if __name__ == "__main__":
    unittest.main()
