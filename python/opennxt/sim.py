"""A software NXT for tests and demos."""

from __future__ import annotations

import struct
import time
from typing import Dict, List, Optional

from . import protocol as P
from .transport import Transport


class SimNXT:
    def __init__(self):
        self.name = "NXT"
        self.bt_address = bytes([0x00, 0x16, 0x53, 0x02, 0xC8, 0xE0])
        self.firmware = (1, 31)
        self.protocol = (1, 124)
        self.battery_mv = 8000
        self.free_flash = 100_000
        self.sleep_ms = 600_000
        self.files: Dict[str, bytes] = {"Untitled-1.rxe": b"\x00" * 300, "Woops.rso": b"\x00" * 1500}
        self.handles: Dict[int, dict] = {}
        self.next_handle = 0
        self.running: Optional[str] = None
        self.motors = [dict(power=0, mode=0, reg=0, turn=0, run=0, limit=0, tacho=0, block=0, rot=0) for _ in range(3)]
        self.sensors = [dict(type=0, mode=0, raw=1023, scaled=0) for _ in range(4)]
        self.ultrasonic_cm = [40, 40, 40, 40]
        self.ls_reply: List[bytes] = [b"", b"", b"", b""]
        self.mailboxes: List[List[bytes]] = [[] for _ in range(20)]
        self.sounds: List = []
        self.log: List = []

    # ------------------------------------------------------------------
    def handle_message(self, msg: bytes) -> Optional[bytes]:
        mtype, cmd = msg[0], msg[1]
        payload = msg[2:]
        self.log.append((cmd, bytes(payload)))
        fn = getattr(self, f"cmd_{cmd:02x}", None)
        if fn is None:
            status, data = 0xBE, b""
        else:
            res = fn(payload)
            status, data = (res if isinstance(res, tuple) else (0, res or b""))
        if mtype & 0x80:
            return None
        return bytes([P.REPLY, cmd, status]) + data

    def _u(self, h):
        self.next_handle = (self.next_handle + 1) & 0xFF
        return self.next_handle

    # ---- direct
    def cmd_00(self, a):
        name = P.cstr(a[:20])
        if name not in self.files:
            return 0xBD, b""
        self.running = name
        return b""

    def cmd_01(self, a):
        if not self.running:
            return 0xEC, b""
        self.running = None
        return b""

    def cmd_02(self, a):
        name = P.cstr(a[1:21])
        if name not in self.files:
            return 0xBD, b""
        self.sounds.append(name)
        return b""

    def cmd_03(self, a):
        hz, ms = struct.unpack("<HH", a[:4])
        self.sounds.append((hz, ms))
        return b""

    def cmd_04(self, a):
        port, power, mode, reg, turn, run, limit = struct.unpack("<BbBBbBI", a[:10])
        ports = range(3) if port == P.PORT_ALL else [port]
        if port != P.PORT_ALL and port > 2:
            return 0xF0, b""
        for p in ports:
            m = self.motors[p]
            m.update(power=power, mode=mode, reg=reg, turn=turn, run=run, limit=limit)
            if mode & P.MOTOR_ON and run != P.RUN_IDLE and power:
                # pretend the motor instantly reaches its target
                delta = limit if limit else 360
                delta = delta if power > 0 else -delta
                m["tacho"] += delta; m["block"] += delta; m["rot"] += delta
                if limit:
                    m["run"] = P.RUN_IDLE
        return b""

    def cmd_05(self, a):
        port, t, mode = a[0], a[1], a[2]
        if port > 3:
            return 0xF0, b""
        self.sensors[port].update(type=t, mode=mode)
        return b""

    def cmd_06(self, a):
        port = a[0]
        if port > 2:
            return 0xF0, b""
        m = self.motors[port]
        return struct.pack("<BbBBbBIiii", port, m["power"], m["mode"], m["reg"], m["turn"], m["run"],
                           m["limit"], m["tacho"], m["block"], m["rot"])

    def cmd_07(self, a):
        port = a[0]
        if port > 3:
            return 0xF0, b""
        s = self.sensors[port]
        return struct.pack("<B??BBHHhh", port, True, False, s["type"], s["mode"], s["raw"], s["raw"], s["scaled"], s["scaled"])

    def cmd_08(self, a):
        self.sensors[a[0]]["scaled"] = 0
        return b""

    def cmd_09(self, a):
        inbox, size = a[0], a[1]
        self.mailboxes[inbox].append(bytes(a[2:2 + size]))
        return b""

    def cmd_0a(self, a):
        m = self.motors[a[0]]
        if a[1]:
            m["block"] = 0
        else:
            m["tacho"] = 0; m["block"] = 0; m["rot"] = 0
        return b""

    def cmd_0b(self, a):
        return struct.pack("<H", self.battery_mv)

    def cmd_0c(self, a):
        return b""

    def cmd_0d(self, a):
        return struct.pack("<I", self.sleep_ms)

    def cmd_0e(self, a):
        port = a[0]
        return bytes([len(self.ls_reply[port])])

    def cmd_0f(self, a):
        port, txlen, rxlen = a[0], a[1], a[2]
        tx = bytes(a[3:3 + txlen])
        if tx == b"\x02\x42":
            self.ls_reply[port] = bytes([self.ultrasonic_cm[port]])
        else:
            self.ls_reply[port] = b"\x00" * rxlen
        return b""

    def cmd_10(self, a):
        port = a[0]
        d = self.ls_reply[port]
        self.ls_reply[port] = b""
        return bytes([len(d)]) + d + b"\x00" * (16 - len(d))

    def cmd_11(self, a):
        if not self.running:
            return 0xEC, b""
        return P.name20(self.running)

    def cmd_13(self, a):
        remote, local, remove = a[0], a[1], a[2]
        box = self.mailboxes[local]
        if not box:
            return 0x40, bytes([local, 0]) + b"\x00" * 59
        msg = box[0] if not remove else box.pop(0)
        msg = msg[:58]
        if not msg.endswith(b"\x00"):
            msg += b"\x00"
        return bytes([local, len(msg)]) + msg + b"\x00" * (59 - len(msg))

    # ---- system
    def cmd_80(self, a):
        name = P.cstr(a[:20])
        if name not in self.files:
            return 0x87, b"\x00" + b"\x00" * 4
        h = self._u(None)
        self.handles[h] = dict(name=name, pos=0, mode="r")
        return bytes([h]) + struct.pack("<I", len(self.files[name]))

    def _open_write(self, a):
        name = P.cstr(a[:20])
        size = struct.unpack("<I", a[20:24])[0]
        if name in self.files:
            return 0x8F, b"\x00"
        if size > self.free_flash:
            return 0x82, b"\x00"
        h = self._u(None)
        self.handles[h] = dict(name=name, data=bytearray(), size=size, mode="w")
        return bytes([h])

    cmd_81 = _open_write
    cmd_89 = _open_write
    cmd_8b = _open_write

    def cmd_82(self, a):
        h = a[0]
        n = struct.unpack("<H", a[1:3])[0]
        f = self.handles.get(h)
        if not f or f["mode"] != "r":
            return 0x93, bytes([h, 0, 0])
        data = self.files[f["name"]][f["pos"]:f["pos"] + n]
        f["pos"] += len(data)
        return bytes([h]) + struct.pack("<H", len(data)) + data

    def cmd_83(self, a):
        h = a[0]
        f = self.handles.get(h)
        if not f or f["mode"] != "w":
            return 0x93, bytes([h, 0, 0])
        chunk = bytes(a[1:])
        if len(f["data"]) + len(chunk) > f["size"]:
            return 0x8E, bytes([h, 0, 0])
        f["data"] += chunk
        return bytes([h]) + struct.pack("<H", len(chunk))

    def cmd_84(self, a):
        h = a[0]
        f = self.handles.pop(h, None)
        if f is None:
            return 0x88, bytes([h])
        if f["mode"] == "w":
            self.files[f["name"]] = bytes(f["data"])
            self.free_flash -= len(f["data"])
        return bytes([h])

    def cmd_85(self, a):
        name = P.cstr(a[:20])
        if name not in self.files:
            return 0x87, P.name20(name)
        self.free_flash += len(self.files.pop(name))
        return P.name20(name)

    def _match(self, pattern: str, name: str) -> bool:
        import fnmatch
        return fnmatch.fnmatch(name.lower(), pattern.lower())

    def cmd_86(self, a):
        pattern = P.cstr(a[:20]) or "*.*"
        names = [n for n in sorted(self.files) if self._match(pattern, n)]
        if not names:
            return 0x87, b"\x00" + b"\x00" * 24
        h = self._u(None)
        self.handles[h] = dict(mode="find", names=names, i=0)
        n = names[0]
        return bytes([h]) + P.name20(n) + struct.pack("<I", len(self.files[n]))

    def cmd_87(self, a):
        h = a[0]
        f = self.handles.get(h)
        if not f or f["mode"] != "find":
            return 0x93, bytes([h]) + b"\x00" * 24
        f["i"] += 1
        if f["i"] >= len(f["names"]):
            return 0x83, bytes([h]) + b"\x00" * 24
        n = f["names"][f["i"]]
        return bytes([h]) + P.name20(n) + struct.pack("<I", len(self.files[n]))

    def cmd_88(self, a):
        return bytes([self.protocol[1], self.protocol[0], self.firmware[1], self.firmware[0]])

    def cmd_97(self, a):
        return 0x00, b""

    def cmd_98(self, a):
        self.name = P.cstr(a[:16])
        return b""

    def cmd_9b(self, a):
        n = self.name.encode()[:15]
        return n + b"\x00" * (15 - len(n)) + self.bt_address + b"\x00" + struct.pack("<II", 200, self.free_flash)

    def cmd_a0(self, a):
        self.files.clear()
        self.free_flash = 100_000
        return b""


class SimTransport(Transport):
    name = "sim"

    def __init__(self, latency: float = 0.0):
        self.nxt = SimNXT()
        self.queue: List[bytes] = []
        self.latency = latency
        self.tx_log: List[bytes] = []

    def send(self, msg: bytes) -> None:
        self.tx_log.append(bytes(msg))
        r = self.nxt.handle_message(bytes(msg))
        if r is not None:
            self.queue.append(r)

    def recv(self, timeout: float) -> Optional[bytes]:
        if self.latency:
            time.sleep(self.latency)
        return self.queue.pop(0) if self.queue else None

    def flush(self) -> None:
        self.queue.clear()
