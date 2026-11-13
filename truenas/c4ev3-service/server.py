#!/usr/bin/env python3
"""OpenEV3 C compile service: C source in, static ARM ELF for the EV3 out.

    GET  /api/c4ev3              health: {"ok": true, "cc": "..."}
    POST /api/c4ev3?name=prog    body = C source (text/plain, <= 256 KB)
                                 200 application/octet-stream  the ELF
                                 422 text/plain                compiler messages (file names hidden)

One compile at a time, 60 s limit. Standard library only. The compiler and the EV3-API
library come from the c4ev3 project (GPL); see the Dockerfile.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CC = os.environ.get("EV3_CC", "ev3-gcc")
STRIP = os.environ.get("EV3_STRIP", "ev3-strip")
API = os.environ.get("EV3_API", "/opt/ev3api")
PORT = int(os.environ.get("PORT", "8084"))
MAX_SOURCE = 256 * 1024
TIMEOUT = 60
LOCK = threading.Lock()
CFLAGS = ["-std=gnu99", "-Os", "-fno-strict-aliasing", "-fwrapv", "-Wall", "-Wno-unused-parameter", "-D_GNU_SOURCE=1",
          "-I", os.path.join(API, "include"), "-I", API, "-I", os.path.join(API, "API")]
LDFLAGS = ["-static", "-lm", "-lpthread"]


def cc_version():
    try:
        return subprocess.run([CC, "--version"], capture_output=True, text=True, timeout=10).stdout.splitlines()[0]
    except Exception as e:  # noqa: BLE001
        return "unavailable: " + str(e)


def compile_source(source: str, name: str):
    """Returns (elf_bytes, None) or (None, messages)."""
    work = tempfile.mkdtemp(prefix="c4ev3-")
    try:
        src = os.path.join(work, name + ".c")
        out = os.path.join(work, name + ".elf")
        with open(src, "w", encoding="utf-8") as f:
            f.write(source)
        cmd = [CC] + CFLAGS + [src, os.path.join(API, "libev3api.a")] + LDFLAGS + ["-o", out]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=work)
        except subprocess.TimeoutExpired:
            return None, "The compiler took more than %d seconds and was stopped." % TIMEOUT
        msgs = (r.stderr + r.stdout).replace(work + os.sep, "").replace(work + "/", "")
        msgs = re.sub(r"^" + re.escape(name) + r"\.c:", "line ", msgs, flags=re.M)
        if r.returncode != 0 or not os.path.exists(out):
            return None, msgs.strip() or ("compiler exit code %d" % r.returncode)
        subprocess.run([STRIP, "--strip-unneeded", out], capture_output=True, timeout=30)
        with open(out, "rb") as f:
            elf = f.read()
        return elf, msgs.strip() or None
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenEV3-c4ev3/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path.rstrip("/") == "/api/c4ev3":
            return self.send(200, {"ok": True, "cc": cc_version(), "api": "c4ev3 EV3-API"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.rstrip("/") != "/api/c4ev3":
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_SOURCE:
            return self.send(413, "Source must be between 1 byte and 256 KB.", "text/plain")
        source = self.rfile.read(n).decode("utf-8", "replace")
        name = re.sub(r"[^A-Za-z0-9_]", "", (parse_qs(u.query).get("name") or ["prog"])[0])[:32] or "prog"
        if not LOCK.acquire(timeout=90):
            return self.send(503, "The compiler is busy; try again in a moment.", "text/plain")
        try:
            elf, msgs = compile_source(source, name)
        finally:
            LOCK.release()
        if elf is None:
            return self.send(422, msgs, "text/plain; charset=utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(elf)))
        self.send_header("Cache-Control", "no-store")
        if msgs:
            self.send_header("X-Compiler-Warnings", str(len(msgs.splitlines())))
        self.end_headers()
        self.wfile.write(elf)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--check":   # used by the Dockerfile
        with open(sys.argv[2], encoding="utf-8") as f:
            elf, msgs = compile_source(f.read(), "check")
        if elf is None:
            print(msgs)
            sys.exit(1)
        print("check: %d-byte ELF, %s" % (len(elf), cc_version()))
        return
    print("c4ev3 compile service on :%d, %s" % (PORT, cc_version()))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
