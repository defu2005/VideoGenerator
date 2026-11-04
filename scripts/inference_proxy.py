#!/usr/bin/env python3
"""Localhost reverse proxy that requires a bearer token before Ollama."""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

UPSTREAM = os.environ.get("OLLAMA_UPSTREAM", "http://127.0.0.1:11434").rstrip("/")
LISTEN = os.environ.get("INFERENCE_PROXY_LISTEN", "127.0.0.1:11435")
TOKEN_FILE = os.environ.get("INFERENCE_TOKEN_FILE", "/workspace/.secrets/token")
ALLOWED = {
    "/api/generate",
    "/api/chat",
    "/api/tags",
    "/api/ps",
    "/api/version",
}

def load_token() -> str:
    with open(TOKEN_FILE, "r", encoding="utf-8") as handle:
        token = handle.read().strip()
    if not token:
        raise SystemExit("token file is empty")
    return token


TOKEN = load_token()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        # Method and path only. Do not log headers or bodies (they can carry the token or prompts).
        path = self.path.split("?", 1)[0]
        if self.command in {"GET", "POST", "HEAD"} and path.startswith("/api/"):
            sys.stderr.write("%s %s\n" % (self.command, path))

    def _unauthorized(self) -> None:
        body = b'{"error":"unauthorized"}\n'
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("WWW-Authenticate", "Bearer")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        body = (json.dumps(payload) + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        scheme, _, presented = header.partition(" ")
        if scheme.lower() != "bearer" or not presented:
            return False
        return hmac.compare_digest(presented.strip(), TOKEN)

    def _read_body(self) -> bytes | None:
        # Drain the body before responding so a keep-alive connection stays aligned.
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length < 0 or length > 8_000_000:
            return None
        return self.rfile.read(length) if length else b""

    def _proxy(self) -> None:
        path = self.path.split("?", 1)[0]
        body = self._read_body()
        self.close_connection = True
        if body is None:
            self._json(413, {"error": "body too large"})
            return
        if path not in ALLOWED:
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._unauthorized()
            return
        upstream = Request(
            UPSTREAM + self.path,
            data=body if body else None,
            method=self.command,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
        )
        try:
            with urlopen(upstream, timeout=300) as response:
                data = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as exc:
            data = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except URLError:
            self._json(502, {"error": "upstream unavailable"})
        except TimeoutError:
            self._json(504, {"error": "upstream timeout"})

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()


def main() -> None:
    host, _, port = LISTEN.partition(":")
    server = ThreadingHTTPServer((host, int(port)), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
