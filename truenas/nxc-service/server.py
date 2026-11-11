"""Tiny HTTP service that compiles NXC source with NBC and returns the .rxe.

    GET  /api/nxc            -> {"compiler": "...", "ok": true}
    POST /api/nxc            body = NXC source (text/plain), optional ?name=prog
                             200 application/octet-stream  the .rxe
                             422 text/plain                 compiler errors
Any origin may call it (CORS *), so the Workbench works both from the NAS and
from a local file:// copy pointed at the NAS.
"""

import json
import os
import re
import shlex
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The compiler command; may carry arguments (e.g. "wine nbc.exe" or "python fake.py").
NBC = shlex.split(os.environ.get("NBC", "nbc"), posix=(os.name != "nt"))
MAX_SOURCE = 4 * 1024 * 1024
TIMEOUT = 30


def compiler_version() -> str:
    try:
        out = subprocess.run(NBC + ["-help"], capture_output=True, text=True, timeout=10)
        first = (out.stdout or out.stderr).strip().splitlines()
        return first[0] if first else "nbc"
    except Exception as e:  # pragma: no cover
        return f"nbc unavailable: {e}"


def compile_nxc(source: str, name: str):
    """Return (ok, rxe_bytes_or_error_text)."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "input.nxc")
        out = os.path.join(d, "output.rxe")
        with open(src, "w", encoding="utf-8", newline="\n") as f:
            f.write(source.replace("\r\n", "\n"))
            if not source.endswith("\n"):
                f.write("\n")
        try:
            proc = subprocess.run(NBC + ["-Z2", "-sm-", "-q", f"-O={out}", src],
                                  capture_output=True, text=True, timeout=TIMEOUT, cwd=d)
        except subprocess.TimeoutExpired:
            return False, "compiler timed out"
        text = (proc.stdout or "") + (proc.stderr or "")
        text = text.replace(src, "input.nxc")
        if proc.returncode != 0 or not os.path.exists(out):
            return False, text.strip() or f"nbc exited with {proc.returncode}"
        with open(out, "rb") as f:
            return True, f.read()


class Handler(BaseHTTPRequestHandler):
    server_version = "opennxt-nxc/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self.path.startswith("/api/nxc"):
            self.send_error(404)
            return
        body = json.dumps({"ok": True, "compiler": compiler_version()}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.path.startswith("/api/nxc"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_SOURCE:
            self.send_error(413, "source too large")
            return
        source = self.rfile.read(length).decode("utf-8", "replace")
        m = re.search(r"[?&]name=([^&]+)", self.path)
        name = m.group(1) if m else "program"
        ok, result = compile_nxc(source, name)
        if ok:
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)
        else:
            body = result.encode("utf-8")
            self.send_response(422)
            self._cors()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter logs
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print("NXC compile service: " + compiler_version(), flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
