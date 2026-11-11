"""A software RCX for tests and demos.

:class:`SimTransport` behaves like a tower connected to a brick: packets
written to it are parsed, the simulated brick updates its state and its
reply (framed exactly like the real thing) becomes readable.  It models the
ROM (no firmware), firmware download, program download, the toggle-bit
duplicate rule, lost replies and the serial tower's echo.
"""

from __future__ import annotations

import struct
from typing import Dict, Optional

from . import protocol as P
from .transport import Transport

ROM_VERSION = 0x00030001
FIRMWARE_VERSION_0328 = 0x00030208   # what a real brick reports after firm0328.lgo

# Ops the ROM answers without firmware present.  Observed on a real RCX 2.0
# (ROM 3.01): anything else gets the previous reply re-sent, not an answer.
ROM_OPS = {P.ALIVE, P.GET_VERSIONS, P.DELETE_FIRMWARE, P.BEGIN_FIRMWARE,
           P.TRANSFER_DATA, P.UNLOCK_FIRMWARE, P.POWER_OFF}


class SimRCX:
    def __init__(self, firmware: bool = False, battery_mv: int = 8700):
        self.firmware_version = FIRMWARE_VERSION_0328 if firmware else 0
        self.battery_mv = battery_mv
        self.last_op: Optional[int] = None
        self.last_reply: Optional[bytes] = None
        self.log = []                     # list of (opcode, args) handled
        # firmware download state
        self.fw_start = None
        self.fw_checksum = None
        self.fw_buf = bytearray()
        self.fw_next_seq = 0
        self.fw_complete = False
        # programs: program -> {(type, number): data}
        self.programs: Dict[int, Dict] = {i: {} for i in range(5)}
        self.program = 0
        self.dl_target = None             # (type, number, length)
        self.dl_buf = bytearray()
        self.dl_next_seq = 0
        # runtime state
        self.variables = [0] * 32
        self.timers = [0] * 4
        self.sensor_type = [0, 0, 0]
        self.sensor_mode = [0, 0, 0]
        self.sensor_values = [0, 0, 0]
        self.motors = [0x4F] * 3          # off, power 7, forward (as a fresh brick reports)
        self.message = 0
        self.watch = 0
        self.running = set()
        self.sounds = []
        self.display = 0
        self.powered_off = False
        self.datalog = []
        self.datalog_size = 0

    # ------------------------------------------------------------------
    def handle(self, body: bytes) -> Optional[bytes]:
        """Process a decoded command body; return reply body or None."""
        op = body[0]
        if op == self.last_op:
            # Byte-identical opcode: the RCX re-sends the last reply only.
            return self.last_reply
        self.last_op = op
        base = op & 0xF7
        args = body[1:]
        self.log.append((base, bytes(args)))
        if self.firmware_version == 0 and base not in ROM_OPS:
            return self.last_reply      # the bare ROM just repeats itself
        handler = getattr(self, f"_op_{base:02x}", None)
        reply = handler(args) if handler else b""
        if reply is None:
            self.last_reply = None
            return None
        self.last_reply = bytes([(~op) & 0xFF]) + reply
        return self.last_reply

    # -- ROM level -------------------------------------------------------
    def _op_10(self, a):  # alive
        return b""

    def _op_15(self, a):  # versions
        if bytes(a) != P.VERSIONS_KEY:
            return None
        return struct.pack(">II", ROM_VERSION, self.firmware_version)

    def _op_30(self, a):  # battery
        return struct.pack("<H", self.battery_mv)

    def _op_60(self, a):
        self.powered_off = True
        return b""

    def _op_65(self, a):  # delete firmware
        if bytes(a) != P.DELETE_FIRMWARE_KEY:
            return None
        self.firmware_version = 0
        self.fw_complete = False
        self.fw_start = None
        return b""

    def _op_75(self, a):  # begin firmware
        if self.firmware_version:
            return None   # ignored while firmware is installed
        if len(a) != 5:
            return None
        self.fw_start = a[0] | (a[1] << 8)
        self.fw_checksum = a[2] | (a[3] << 8)
        self.fw_buf = bytearray()
        self.fw_next_seq = 1
        self.fw_complete = False
        self.dl_target = None
        return b"\x00"

    def _op_45(self, a):  # transfer data
        if len(a) < 5:
            return None
        seq = a[0] | (a[1] << 8)
        length = a[2] | (a[3] << 8)
        data = bytes(a[4:4 + length])
        if len(a) != 4 + length + 1:
            return b"\x03"
        csum = a[4 + length]
        if seq != 0 and csum != P.checksum8(data):
            return b"\x03"
        if self.fw_start is not None and not self.fw_complete and self.firmware_version == 0:
            if seq != 0 and seq != self.fw_next_seq:
                return None   # out of sequence: silence
            self.fw_buf += data
            self.fw_next_seq += 1
            if seq == 0:
                want = self.fw_checksum
                got = sum(self.fw_buf[:0x4C00]) & 0xFFFF
                if got != want:
                    return b"\x04"
                self.fw_complete = True
            return b"\x00"
        if self.dl_target is not None:
            if seq != 0 and seq != self.dl_next_seq:
                return None
            self.dl_buf += data
            self.dl_next_seq += 1
            if seq == 0:
                t, num, _length = self.dl_target
                self.programs[self.program][(t, num)] = bytes(self.dl_buf)
                self.dl_target = None
            return b"\x00"
        return b"\x06"

    def _op_a5(self, a):  # unlock firmware
        if bytes(a) != P.UNLOCK_KEY:
            return None
        if self.fw_complete and self.firmware_version == 0:
            self.firmware_version = FIRMWARE_VERSION_0328
            self.fw_complete = False
            return P.UNLOCK_REPLY
        if self.firmware_version:
            return P.UNLOCK_REPLY
        return None

    # -- firmware level ----------------------------------------------------
    def _op_51(self, a):
        self.sounds.append(a[0])
        return b""

    def _op_23(self, a):
        self.sounds.append(("tone", a[0] | (a[1] << 8), a[2]))
        return b""

    def _op_21(self, a):  # motor on/off/float
        code = a[0]
        for i in range(3):
            if code & (1 << i):
                self.motors[i] = (self.motors[i] & 0x0F) | (code & 0xC0)
        return b""

    def _op_e1(self, a):  # motor direction; status bit 3 set = forward (real brick)
        code = a[0]
        for i in range(3):
            if code & (1 << i):
                if code & 0x40:
                    self.motors[i] ^= 0x08
                elif code & 0x80:
                    self.motors[i] |= 0x08
                else:
                    self.motors[i] &= ~0x08
        return b""

    def _op_13(self, a):  # motor power
        bits, src, val = a[0], a[1], a[2]
        for i in range(3):
            if bits & (1 << i):
                self.motors[i] = (self.motors[i] & 0xF8) | (val & 7)
        return b""

    def _op_32(self, a):
        self.sensor_type[a[0] & 3 if a[0] < 3 else 0] = a[1]
        return b""

    def _op_42(self, a):
        self.sensor_mode[a[0] if a[0] < 3 else 0] = a[1]
        return b""

    def _op_d1(self, a):
        if a[0] < 3:
            self.sensor_values[a[0]] = 0
        return b""

    def _op_14(self, a):  # set variable
        idx, src = a[0], a[1]
        val = struct.unpack("<h", bytes(a[2:4]))[0]
        if src == P.SRC_CONSTANT and idx < 32:
            self.variables[idx] = val
        return b""

    def _op_12(self, a):  # get value
        src, idx = a[0], a[1]
        v = 0
        if src == P.SRC_VARIABLE:
            v = self.variables[idx & 31]
        elif src == P.SRC_TIMER:
            v = self.timers[idx & 3]
        elif src == P.SRC_MOTOR_STATUS:
            v = self.motors[idx % 3]
        elif src == P.SRC_PROGRAM:
            v = self.program
        elif src in (P.SRC_SENSOR_VALUE, P.SRC_SENSOR_RAW):
            v = self.sensor_values[idx % 3]
        elif src == P.SRC_SENSOR_BOOL:
            v = 1 if self.sensor_values[idx % 3] else 0
        elif src == P.SRC_SENSOR_TYPE:
            v = self.sensor_type[idx % 3]
        elif src == P.SRC_SENSOR_MODE:
            v = self.sensor_mode[idx % 3]
        elif src == P.SRC_WATCH:
            v = self.watch
        elif src == P.SRC_MESSAGE:
            v = self.message
        elif src in (P.SRC_CONSTANT, P.SRC_RANDOM):
            return None
        return struct.pack("<h", v)

    def _op_33(self, a):
        self.display = a[1]
        return b""

    def _op_22(self, a):
        self.watch = a[0] * 60 + a[1]
        return b""

    def _op_91(self, a):
        self.program = a[0] % 5
        self.running.clear()
        return b""

    def _op_40(self, a):
        p = self.programs[self.program]
        for k in [k for k in p if k[0] == 0]:
            del p[k]
        return b""

    def _op_70(self, a):
        p = self.programs[self.program]
        for k in [k for k in p if k[0] == 1]:
            del p[k]
        return b""

    def _begin(self, kind: int, a):
        number = a[1] | (a[2] << 8)
        length = a[3] | (a[4] << 8)
        limit = 10 if kind == 0 else 8
        if number >= limit:
            return b"\x02"
        used = sum(len(d) for d in self.programs[self.program].values())
        if used + length > 6000:
            return b"\x01"
        self.dl_target = (kind, number, length)
        self.dl_buf = bytearray()
        self.dl_next_seq = 1
        return b"\x00"

    def _op_25(self, a):
        return self._begin(0, a)

    def _op_35(self, a):
        return self._begin(1, a)

    def _op_71(self, a):
        self.running.add(a[0])
        return b""

    def _op_81(self, a):
        self.running.discard(a[0])
        return b""

    def _op_50(self, a):
        self.running.clear()
        return b""

    def _op_61(self, a):
        self.programs[self.program].pop((0, a[0]), None)
        return b""

    def _op_c1(self, a):
        self.programs[self.program].pop((1, a[0]), None)
        return b""

    def _op_20(self, a):  # memory map: 94 big-endian words
        words = [0] * 94
        words[92] = 0x9000
        words[93] = 0xFFFF
        return struct.pack(">94H", *words)

    def _op_52(self, a):
        self.datalog_size = a[0] | (a[1] << 8)
        self.datalog = []
        return b"\x00"

    def _op_a4(self, a):
        first = a[0] | (a[1] << 8)
        count = a[2] | (a[3] << 8)
        entries = [(0xFF, len(self.datalog) + 1)] + list(self.datalog)
        out = bytearray()
        for i in range(first, first + count):
            kind, val = entries[i] if i < len(entries) else (0, 0)
            out += bytes([kind]) + struct.pack("<h", val)
        return bytes(out)

    def _op_f7(self, a):
        self.message = a[0]
        return None   # never answered

    def _op_b1(self, a):
        return b""

    def _op_31(self, a):
        return b""

    def _op_a1(self, a):
        self.timers[a[0] & 3] = 0
        return b""


class SimTransport(Transport):
    """Transport wrapper around :class:`SimRCX`."""

    name = "sim"

    def __init__(self, firmware: bool = False, echoes: bool = False,
                 drop_replies: int = 0, latency_bytes: int = 0):
        self.rcx = SimRCX(firmware=firmware)
        self.echoes = echoes
        self.drop_replies = drop_replies   # swallow the next N replies
        self.rx = bytearray()
        self.tx_log = []

    def write(self, data: bytes) -> None:
        self.tx_log.append(bytes(data))
        if self.echoes:
            self.rx += data
        body = P.parse_command(bytes(data))
        if body is None:
            return
        reply = self.rcx.handle(body)
        if reply is None:
            return
        if self.drop_replies > 0:
            self.drop_replies -= 1
            return
        self.rx += P.build_packet(reply)

    def read(self, max_bytes: int, timeout: float) -> bytes:
        out = bytes(self.rx[:max_bytes])
        del self.rx[:len(out)]
        return out

    def flush_input(self) -> None:
        self.rx.clear()

    def tx_seconds(self, nbytes: int) -> float:
        return 0.0
