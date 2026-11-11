"""Simulated EV3: a transport that feeds messages into the small VM."""

from __future__ import annotations

import struct
from typing import List, Optional

from . import protocol as P
from .transport import Transport
from .vm import VM, BrickState, VMError


class SimEV3:
    def __init__(self):
        self.state = BrickState()
        self.handles = {}
        self.next_handle = 0
        self.log: List[str] = self.state.log

    def handle(self, msg: bytes) -> Optional[bytes]:
        counter, typ, rest = P.parse_message(msg)
        if typ in (P.DIRECT_REPLY, P.DIRECT_NO_REPLY):
            header = struct.unpack_from("<H", rest, 0)[0]
            g, l = header & 0x3FF, header >> 10
            vm = VM(self.state, g, l, rest[2:])
            try:
                vm.run()
                reply = bytes([P.REPLY_DIRECT]) + bytes(vm.g)
            except VMError as e:
                self.log.append("VM error: " + str(e))
                reply = bytes([P.REPLY_DIRECT_ERROR]) + bytes(vm.g)
            if typ == P.DIRECT_NO_REPLY:
                return None
            return self._frame(counter, reply)
        cmd, payload = rest[0], rest[1:]
        status, data = self._system(cmd, payload)
        if typ == P.SYSTEM_NO_REPLY:
            return None
        return self._frame(counter, bytes([P.REPLY_SYSTEM if status == 0 or status == 8 else P.REPLY_SYSTEM_ERROR, cmd, status]) + data)

    @staticmethod
    def _frame(counter: int, body: bytes) -> bytes:
        body = struct.pack("<H", counter) + body
        return struct.pack("<H", len(body)) + body

    def _h(self) -> int:
        self.next_handle = (self.next_handle + 1) & 0xFF
        return self.next_handle

    def _system(self, cmd: int, a: bytes):
        f = self.state.files
        cstr = lambda b: b.split(b"\x00")[0].decode()
        if cmd == P.BEGIN_DOWNLOAD:
            size = struct.unpack_from("<I", a, 0)[0]
            name = cstr(a[4:])
            h = self._h()
            self.handles[h] = dict(name=name, size=size, data=bytearray())
            return 0, bytes([h])
        if cmd == P.CONTINUE_DOWNLOAD:
            h = a[0]
            fh = self.handles.get(h)
            if not fh:
                return 1, bytes([h])
            fh["data"] += a[1:]
            if len(fh["data"]) >= fh["size"]:
                f[fh["name"]] = bytes(fh["data"][:fh["size"]])
                del self.handles[h]
                return 8, bytes([h])
            return 0, bytes([h])
        if cmd == P.BEGIN_UPLOAD or cmd == P.BEGIN_GETFILE:
            maxb = struct.unpack_from("<H", a, 0)[0]
            name = cstr(a[2:])
            if name not in f:
                return 6, b""
            data = f[name]
            h = self._h()
            self.handles[h] = dict(name=name, pos=min(maxb, len(data)))
            status = 8 if len(data) <= maxb else 0
            if status == 8:
                del self.handles[h]
            return status, struct.pack("<I", len(data)) + bytes([h]) + data[:maxb]
        if cmd == P.CONTINUE_UPLOAD or cmd == P.CONTINUE_GETFILE:
            h = a[0]
            maxb = struct.unpack_from("<H", a, 1)[0]
            fh = self.handles.get(h)
            if not fh:
                return 1, bytes([h])
            data = f[fh["name"]]
            part = data[fh["pos"]:fh["pos"] + maxb]
            fh["pos"] += len(part)
            status = 8 if fh["pos"] >= len(data) else 0
            if status == 8:
                del self.handles[h]
            return status, bytes([h]) + part
        if cmd == P.LIST_FILES:
            maxb = struct.unpack_from("<H", a, 0)[0]
            path = cstr(a[2:])
            names = sorted(n for n in f if n.startswith(path))
            lines = []
            seen = set()
            for n in names:
                rest = n[len(path):]
                if "/" in rest:
                    d = rest.split("/")[0] + "/"
                    if d not in seen:
                        seen.add(d)
                        lines.append(d)
                else:
                    lines.append(f"{'0' * 32} {len(f[n]):08X} {rest}")
            text = "\n".join(lines).encode() + (b"\n" if lines else b"")
            h = self._h()
            if len(text) <= maxb:
                return 8, struct.pack("<I", len(text)) + bytes([h]) + text
            self.handles[h] = dict(text=text, pos=maxb)
            return 0, struct.pack("<I", len(text)) + bytes([h]) + text[:maxb]
        if cmd == P.CONTINUE_LIST_FILES:
            h = a[0]
            maxb = struct.unpack_from("<H", a, 1)[0]
            fh = self.handles.get(h)
            if not fh:
                return 1, bytes([h])
            part = fh["text"][fh["pos"]:fh["pos"] + maxb]
            fh["pos"] += len(part)
            status = 8 if fh["pos"] >= len(fh["text"]) else 0
            return status, bytes([h]) + part
        if cmd == P.CREATE_DIR:
            return 0, b""
        if cmd == P.DELETE_FILE:
            name = cstr(a)
            if name not in f:
                return 6, b""
            del f[name]
            return 0, b""
        if cmd == P.CLOSE_FILEHANDLE:
            self.handles.pop(a[0], None)
            return 0, b""
        return 10, b""


class SimTransport(Transport):
    name = "sim"

    def __init__(self):
        self.ev3 = SimEV3()
        self.queue: List[bytes] = []
        self.tx_log: List[bytes] = []

    def send(self, msg: bytes) -> None:
        self.tx_log.append(bytes(msg))
        r = self.ev3.handle(bytes(msg))
        if r is not None:
            self.queue.append(r)

    def recv(self, timeout: float) -> Optional[bytes]:
        return self.queue.pop(0) if self.queue else None
