"""A small lms2012 virtual machine for the EV3 simulator.

It executes the subset of bytecodes OpenEV3 generates (brick API, block programs):
constants and variables of all encodings, moves, arithmetic, comparisons, jumps,
timers, UI (battery, versions, LEDs, display text, buttons), sound, input devices
(type/mode and SI values), outputs (power, speed, step/time, sync, tacho), COM
(brick name), INFO (volume), FILE LOAD_IMAGE and PROGRAM_START/STOP.
"""

from __future__ import annotations

import math
import struct
import time
from typing import Callable, Dict, List, Optional

from . import protocol as P


class VMError(Exception):
    pass


class Ref:
    """A variable reference (global or local) the VM can write to."""
    __slots__ = ("mem", "offset")

    def __init__(self, mem: bytearray, offset: int):
        self.mem, self.offset = mem, offset


class BrickState:
    """What the simulated brick knows about itself."""

    def __init__(self):
        self.name = "EV3"
        self.fw = "V1.09H"
        self.hw = "V0.60"
        self.os = "Linux 2.6.33-rc"
        self.battery_v = 7.9
        self.battery_pct = 95
        self.led = 1
        self.volume = 50
        self.display: List[str] = []
        self.sounds: List = []
        self.buttons = {k: False for k in P.BUTTONS}
        # input ports 0..3: type, mode, values ; output ports 16..19 are motors
        self.inputs = [dict(type=126, mode=0, values=[0.0]) for _ in range(4)]
        self.motors = [dict(type=7 if i < 3 else 126, power=0, speed=0, running=False, tacho=0, polarity=1) for i in range(4)]
        self.files: Dict[str, bytes] = {"../prjs/BrkProg_SAVE/Demo.rpf": b"LEGO" + bytes(60)}
        self.running_program: Optional[str] = None
        self.sleep_minutes = 30
        self.log: List[str] = []
        self.clock = time.monotonic

    def device_type(self, no: int) -> int:
        if no < 4:
            return self.inputs[no]["type"]
        if 16 <= no < 20:
            return self.motors[no - 16]["type"]
        return 126


class VM:
    def __init__(self, brick: BrickState, globals_size: int = 0, locals_size: int = 0, code: bytes = b"",
                 sleeper: Optional[Callable[[float], None]] = None):
        self.b = brick
        self.g = bytearray(globals_size)
        self.l = bytearray(locals_size)
        self.code = code
        self.pc = 0
        self.sleeper = sleeper or (lambda s: None)
        self.timers: Dict[int, float] = {}
        self.stopped = False
        self.steps = 0

    # ---- parameter decoding --------------------------------------------
    def _byte(self) -> int:
        v = self.code[self.pc]
        self.pc += 1
        return v

    def param(self):
        """Return an int/float/str constant or a Ref."""
        b = self._byte()
        if b & 0x80 == 0:                      # short format
            if b & 0x40:                       # variable
                idx = b & 0x1F
                return Ref(self.g if b & 0x20 else self.l, idx)
            v = b & 0x3F
            return v - 64 if v & 0x20 else v   # 6-bit signed constant
        # long format
        if b & 0x40:                           # variable
            mem = self.g if b & 0x20 else self.l
            size = b & 0x07
            if size == 1:
                idx = self._byte()
            elif size == 2:
                idx = struct.unpack_from("<H", self.code, self.pc)[0]; self.pc += 2
            else:
                idx = struct.unpack_from("<I", self.code, self.pc)[0]; self.pc += 4
            return Ref(mem, idx)
        size = b & 0x07
        if size == 0 or b == 0x84:             # zero-terminated string
            end = self.code.index(b"\x00", self.pc)
            s = self.code[self.pc:end].decode("ascii", "replace")
            self.pc = end + 1
            return s
        if size == 1:
            v = struct.unpack_from("<b", self.code, self.pc)[0]; self.pc += 1
        elif size == 2:
            v = struct.unpack_from("<h", self.code, self.pc)[0]; self.pc += 2
        else:
            v = struct.unpack_from("<i", self.code, self.pc)[0]; self.pc += 4
        return v

    def val(self, size: int = 4, f: bool = False):
        p = self.param()
        if isinstance(p, Ref):
            return self.read(p, size, f)
        return p

    def ref(self) -> Ref:
        p = self.param()
        if not isinstance(p, Ref):
            raise VMError(f"expected a variable at {self.pc}")
        return p

    def read(self, r: Ref, size: int, f: bool = False):
        fmt = {1: "<b", 2: "<h", 4: "<f" if f else "<i"}[size]
        return struct.unpack_from(fmt, r.mem, r.offset)[0]

    def write(self, r: Ref, value, size: int, f: bool = False):
        fmt = {1: "<b", 2: "<h", 4: "<f" if f else "<i"}[size]
        if not f:
            value = int(value)
            lim = {1: 0x7F, 2: 0x7FFF, 4: 0x7FFFFFFF}[size]
            value = max(-lim - 1, min(lim, value))
        struct.pack_into(fmt, r.mem, r.offset, value)

    def write_str(self, r: Ref, s: str, maxlen: int) -> None:
        b = s.encode("ascii", "replace")[:max(0, maxlen - 1)] + b"\x00"
        r.mem[r.offset:r.offset + len(b)] = b

    # ---- execution -------------------------------------------------------
    def run(self, max_steps: int = 200000) -> None:
        while self.pc < len(self.code) and not self.stopped:
            self.steps += 1
            if self.steps > max_steps:
                raise VMError("program ran too long (infinite loop?)")
            opc = self._byte()
            name = P.OP_NAMES.get(opc)
            handler = getattr(self, "op_" + name, None) if name else None
            if handler is None:
                raise VMError(f"unsupported opcode 0x{opc:02x} ({name}) at {self.pc - 1}")
            handler()

    # -- control
    def op_NOP(self): pass
    def op_OBJECT_END(self): self.stopped = True
    def op_RETURN(self): self.stopped = True
    def op_PROGRAM_STOP(self):
        self.val(2); self.b.running_program = None; self.b.log.append("PROGRAM_STOP")
    def op_PROGRAM_START(self):
        slot = self.val(2); size = self.val(4); ip = self.val(4); dbg = self.val(1)
        self.b.log.append(f"PROGRAM_START slot {slot}")
    def op_OBJECT_START(self): self.val(2)
    def op_OBJECT_STOP(self): self.val(2)
    def op_SLEEP(self): pass
    def op_KEEP_ALIVE(self): r = self.ref(); self.write(r, self.b.sleep_minutes, 1)
    def op_TST(self): self.val(1)

    def _jump(self, taken: bool, off: int):
        if taken:
            self.pc += off

    def op_JR(self): off = self.val(4); self._jump(True, off)
    def op_JR_FALSE(self): v = self.val(1); off = self.val(4); self._jump(v == 0, off)
    def op_JR_TRUE(self): v = self.val(1); off = self.val(4); self._jump(v != 0, off)
    def op_JR_NAN(self): v = self.val(4, True); off = self.val(4); self._jump(math.isnan(v), off)

    def _cmpjr(self, size, f, fn):
        a = self.val(size, f); b_ = self.val(size, f); off = self.val(4); self._jump(fn(a, b_), off)
    def op_JR_LT8(self): self._cmpjr(1, False, lambda a, b: a < b)
    def op_JR_LT16(self): self._cmpjr(2, False, lambda a, b: a < b)
    def op_JR_LT32(self): self._cmpjr(4, False, lambda a, b: a < b)
    def op_JR_LTF(self): self._cmpjr(4, True, lambda a, b: a < b)
    def op_JR_GT8(self): self._cmpjr(1, False, lambda a, b: a > b)
    def op_JR_GT16(self): self._cmpjr(2, False, lambda a, b: a > b)
    def op_JR_GT32(self): self._cmpjr(4, False, lambda a, b: a > b)
    def op_JR_GTF(self): self._cmpjr(4, True, lambda a, b: a > b)
    def op_JR_EQ8(self): self._cmpjr(1, False, lambda a, b: a == b)
    def op_JR_EQ16(self): self._cmpjr(2, False, lambda a, b: a == b)
    def op_JR_EQ32(self): self._cmpjr(4, False, lambda a, b: a == b)
    def op_JR_EQF(self): self._cmpjr(4, True, lambda a, b: a == b)
    def op_JR_NEQ8(self): self._cmpjr(1, False, lambda a, b: a != b)
    def op_JR_NEQ16(self): self._cmpjr(2, False, lambda a, b: a != b)
    def op_JR_NEQ32(self): self._cmpjr(4, False, lambda a, b: a != b)
    def op_JR_NEQF(self): self._cmpjr(4, True, lambda a, b: a != b)
    def op_JR_LTEQ8(self): self._cmpjr(1, False, lambda a, b: a <= b)
    def op_JR_LTEQ16(self): self._cmpjr(2, False, lambda a, b: a <= b)
    def op_JR_LTEQ32(self): self._cmpjr(4, False, lambda a, b: a <= b)
    def op_JR_LTEQF(self): self._cmpjr(4, True, lambda a, b: a <= b)
    def op_JR_GTEQ8(self): self._cmpjr(1, False, lambda a, b: a >= b)
    def op_JR_GTEQ16(self): self._cmpjr(2, False, lambda a, b: a >= b)
    def op_JR_GTEQ32(self): self._cmpjr(4, False, lambda a, b: a >= b)
    def op_JR_GTEQF(self): self._cmpjr(4, True, lambda a, b: a >= b)

    # -- data
    def _move(self, s1, f1, s2, f2):
        v = self.val(s1, f1); r = self.ref(); self.write(r, v, s2, f2)
    def op_MOVE8_8(self): self._move(1, False, 1, False)
    def op_MOVE8_16(self): self._move(1, False, 2, False)
    def op_MOVE8_32(self): self._move(1, False, 4, False)
    def op_MOVE8_F(self): self._move(1, False, 4, True)
    def op_MOVE16_8(self): self._move(2, False, 1, False)
    def op_MOVE16_16(self): self._move(2, False, 2, False)
    def op_MOVE16_32(self): self._move(2, False, 4, False)
    def op_MOVE16_F(self): self._move(2, False, 4, True)
    def op_MOVE32_8(self): self._move(4, False, 1, False)
    def op_MOVE32_16(self): self._move(4, False, 2, False)
    def op_MOVE32_32(self): self._move(4, False, 4, False)
    def op_MOVE32_F(self): self._move(4, False, 4, True)
    def op_MOVEF_8(self): self._move(4, True, 1, False)
    def op_MOVEF_16(self): self._move(4, True, 2, False)
    def op_MOVEF_32(self): self._move(4, True, 4, False)
    def op_MOVEF_F(self): self._move(4, True, 4, True)

    def _arith(self, size, f, fn):
        a = self.val(size, f); b_ = self.val(size, f); r = self.ref()
        try:
            v = fn(a, b_)
        except ZeroDivisionError:
            v = float("nan") if f else 0
        self.write(r, v, size, f)
    def op_ADD8(self): self._arith(1, False, lambda a, b: a + b)
    def op_ADD16(self): self._arith(2, False, lambda a, b: a + b)
    def op_ADD32(self): self._arith(4, False, lambda a, b: a + b)
    def op_ADDF(self): self._arith(4, True, lambda a, b: a + b)
    def op_SUB8(self): self._arith(1, False, lambda a, b: a - b)
    def op_SUB16(self): self._arith(2, False, lambda a, b: a - b)
    def op_SUB32(self): self._arith(4, False, lambda a, b: a - b)
    def op_SUBF(self): self._arith(4, True, lambda a, b: a - b)
    def op_MUL8(self): self._arith(1, False, lambda a, b: a * b)
    def op_MUL16(self): self._arith(2, False, lambda a, b: a * b)
    def op_MUL32(self): self._arith(4, False, lambda a, b: a * b)
    def op_MULF(self): self._arith(4, True, lambda a, b: a * b)
    def op_DIV8(self): self._arith(1, False, lambda a, b: int(a / b))
    def op_DIV16(self): self._arith(2, False, lambda a, b: int(a / b))
    def op_DIV32(self): self._arith(4, False, lambda a, b: int(a / b))
    def op_DIVF(self): self._arith(4, True, lambda a, b: a / b)
    def op_AND8(self): self._arith(1, False, lambda a, b: a & b)
    def op_AND16(self): self._arith(2, False, lambda a, b: a & b)
    def op_AND32(self): self._arith(4, False, lambda a, b: a & b)
    def op_OR8(self): self._arith(1, False, lambda a, b: a | b)
    def op_OR16(self): self._arith(2, False, lambda a, b: a | b)
    def op_OR32(self): self._arith(4, False, lambda a, b: a | b)
    def op_XOR8(self): self._arith(1, False, lambda a, b: a ^ b)
    def op_XOR16(self): self._arith(2, False, lambda a, b: a ^ b)
    def op_XOR32(self): self._arith(4, False, lambda a, b: a ^ b)

    def _cp(self, size, f, fn):
        a = self.val(size, f); b_ = self.val(size, f); r = self.ref(); self.write(r, 1 if fn(a, b_) else 0, 1)
    def op_CP_LT8(self): self._cp(1, False, lambda a, b: a < b)
    def op_CP_LT16(self): self._cp(2, False, lambda a, b: a < b)
    def op_CP_LT32(self): self._cp(4, False, lambda a, b: a < b)
    def op_CP_LTF(self): self._cp(4, True, lambda a, b: a < b)
    def op_CP_GT8(self): self._cp(1, False, lambda a, b: a > b)
    def op_CP_GT16(self): self._cp(2, False, lambda a, b: a > b)
    def op_CP_GT32(self): self._cp(4, False, lambda a, b: a > b)
    def op_CP_GTF(self): self._cp(4, True, lambda a, b: a > b)
    def op_CP_EQ8(self): self._cp(1, False, lambda a, b: a == b)
    def op_CP_EQ16(self): self._cp(2, False, lambda a, b: a == b)
    def op_CP_EQ32(self): self._cp(4, False, lambda a, b: a == b)
    def op_CP_EQF(self): self._cp(4, True, lambda a, b: a == b)
    def op_CP_NEQ8(self): self._cp(1, False, lambda a, b: a != b)
    def op_CP_NEQ16(self): self._cp(2, False, lambda a, b: a != b)
    def op_CP_NEQ32(self): self._cp(4, False, lambda a, b: a != b)
    def op_CP_NEQF(self): self._cp(4, True, lambda a, b: a != b)
    def op_CP_LTEQ8(self): self._cp(1, False, lambda a, b: a <= b)
    def op_CP_LTEQ16(self): self._cp(2, False, lambda a, b: a <= b)
    def op_CP_LTEQ32(self): self._cp(4, False, lambda a, b: a <= b)
    def op_CP_LTEQF(self): self._cp(4, True, lambda a, b: a <= b)
    def op_CP_GTEQ8(self): self._cp(1, False, lambda a, b: a >= b)
    def op_CP_GTEQ16(self): self._cp(2, False, lambda a, b: a >= b)
    def op_CP_GTEQ32(self): self._cp(4, False, lambda a, b: a >= b)
    def op_CP_GTEQF(self): self._cp(4, True, lambda a, b: a >= b)

    def op_MATH(self):
        sub = self.val(1)
        if sub in (P.MATH["POW"], P.MATH["MOD"]):
            a = self.val(4, True); b_ = self.val(4, True); r = self.ref()
            self.write(r, a ** b_ if sub == P.MATH["POW"] else math.fmod(a, b_), 4, True)
            return
        if sub in (P.MATH["MOD8"], P.MATH["MOD16"], P.MATH["MOD32"]):
            size = {P.MATH["MOD8"]: 1, P.MATH["MOD16"]: 2, P.MATH["MOD32"]: 4}[sub]
            a = self.val(size); b_ = self.val(size); r = self.ref(); self.write(r, a % b_ if b_ else 0, size)
            return
        a = self.val(4, True); r = self.ref()
        fn = {1: math.exp, 3: math.floor, 4: math.ceil, 5: round, 6: abs, 7: lambda x: -x, 8: math.sqrt,
              9: math.log10, 10: math.log, 11: lambda x: math.sin(math.radians(x)), 12: lambda x: math.cos(math.radians(x)),
              13: lambda x: math.tan(math.radians(x)), 14: lambda x: math.degrees(math.asin(x)),
              15: lambda x: math.degrees(math.acos(x)), 16: lambda x: math.degrees(math.atan(x)), 21: math.trunc}[sub]
        try:
            self.write(r, fn(a), 4, True)
        except ValueError:
            self.write(r, float("nan"), 4, True)

    def op_RANDOM(self):
        import random
        lo = self.val(2); hi = self.val(2); r = self.ref(); self.write(r, random.randint(min(lo, hi), max(lo, hi)), 2)

    def op_STRINGS(self):
        sub = self.val(1)
        if sub == 2:   # ADD
            a = self.val(); b_ = self.val(); size = self.val(1); r = self.ref(); self.write_str(r, str(a) + str(b_), size)
        elif sub == 3:  # COMPARE
            a = self.val(); b_ = self.val(); r = self.ref(); self.write(r, 1 if a == b_ else 0, 1)
        elif sub == 5:  # VALUE_TO_STRING
            v = self.val(4, True); figures = self.val(1); dec = self.val(1); r = self.ref(); self.write_str(r, f"{v:.{dec}f}", 32)
        elif sub == 6:  # NUMBER_TO_STRING
            v = self.val(2); figures = self.val(1); r = self.ref(); self.write_str(r, str(v), 32)
        else:
            raise VMError(f"STRINGS subcode {sub}")

    # -- timers
    def op_TIMER_WAIT(self):
        ms = self.val(4); r = self.ref()
        self.sleeper(ms / 1000.0)
        self.write(r, 0, 4)
    def op_TIMER_READY(self): self.val(4)
    def op_TIMER_READ(self): r = self.ref(); self.write(r, int((self.b.clock() * 1000) % 2147483647), 4)
    def op_TIMER_READ_US(self): r = self.ref(); self.write(r, int((self.b.clock() * 1e6) % 2147483647), 4)

    # -- UI
    def op_UI_READ(self):
        sub = self.val(1); b = self.b
        if sub == P.UI_READ["GET_VBATT"]: self.write(self.ref(), b.battery_v, 4, True)
        elif sub == P.UI_READ["GET_LBATT"]: self.write(self.ref(), b.battery_pct, 1)
        elif sub == P.UI_READ["GET_IBATT"]: self.write(self.ref(), 0.2, 4, True)
        elif sub == P.UI_READ["GET_TBATT"]: self.write(self.ref(), 25.0, 4, True)
        elif sub == P.UI_READ["GET_FW_VERS"]: n = self.val(1); self.write_str(self.ref(), b.fw, n)
        elif sub == P.UI_READ["GET_HW_VERS"]: n = self.val(1); self.write_str(self.ref(), b.hw, n)
        elif sub == P.UI_READ["GET_OS_VERS"]: n = self.val(1); self.write_str(self.ref(), b.os, n)
        elif sub == P.UI_READ["GET_FW_BUILD"]: n = self.val(1); self.write_str(self.ref(), "1309111008", n)
        elif sub == P.UI_READ["GET_OS_BUILD"]: n = self.val(1); self.write_str(self.ref(), "1305241440", n)
        elif sub == P.UI_READ["GET_VERSION"]: n = self.val(1); self.write_str(self.ref(), "sim", n)
        elif sub == P.UI_READ["GET_IP"]: n = self.val(1); self.write_str(self.ref(), "0.0.0.0", n)
        elif sub == P.UI_READ["GET_SDCARD"]: self.write(self.ref(), 0, 1); self.write(self.ref(), 0, 4); self.write(self.ref(), 0, 4)
        elif sub == P.UI_READ["GET_USBSTICK"]: self.write(self.ref(), 0, 1); self.write(self.ref(), 0, 4); self.write(self.ref(), 0, 4)
        else: raise VMError(f"UI_READ {sub}")

    def op_UI_WRITE(self):
        sub = self.val(1); b = self.b
        if sub == P.UI_WRITE["LED"]: b.led = self.val(1); b.log.append(f"LED {b.led}")
        elif sub == P.UI_WRITE["PUT_STRING"]: b.log.append("PUT_STRING " + str(self.val()))
        elif sub in (P.UI_WRITE["VALUE8"], P.UI_WRITE["VALUE16"], P.UI_WRITE["VALUE32"]): self.val()
        elif sub == P.UI_WRITE["VALUEF"]: self.val(4, True)
        elif sub == P.UI_WRITE["WRITE_FLUSH"]: pass
        elif sub == P.UI_WRITE["SET_BUSY"]: self.val(1)
        else: raise VMError(f"UI_WRITE {sub}")

    def op_UI_DRAW(self):
        sub = self.val(1); b = self.b
        if sub == P.UI_DRAW["UPDATE"]: pass
        elif sub == P.UI_DRAW["CLEAN"]: b.display = []
        elif sub == P.UI_DRAW["FILLWINDOW"]: self.val(1); self.val(2); self.val(2); b.display = []
        elif sub == P.UI_DRAW["SELECT_FONT"]: self.val(1)
        elif sub == P.UI_DRAW["TEXT"]: c = self.val(1); x = self.val(2); y = self.val(2); s = self.val(); b.display.append(f"({x},{y}) {s}")
        elif sub == P.UI_DRAW["VALUE"]: c = self.val(1); x = self.val(2); y = self.val(2); v = self.val(4, True); fig = self.val(1); dec = self.val(1); b.display.append(f"({x},{y}) {v:.{dec}f}")
        elif sub == P.UI_DRAW["PIXEL"]: self.val(1); self.val(2); self.val(2)
        elif sub == P.UI_DRAW["LINE"]: self.val(1); self.val(2); self.val(2); self.val(2); self.val(2)
        elif sub in (P.UI_DRAW["RECT"], P.UI_DRAW["FILLRECT"], P.UI_DRAW["INVERSERECT"]): self.val(1); self.val(2); self.val(2); self.val(2); self.val(2)
        elif sub in (P.UI_DRAW["CIRCLE"], P.UI_DRAW["FILLCIRCLE"]): self.val(1); self.val(2); self.val(2); self.val(2)
        elif sub == P.UI_DRAW["TOPLINE"]: self.val(1)
        elif sub == P.UI_DRAW["BMPFILE"]: self.val(1); self.val(2); self.val(2); b.display.append("picture " + str(self.val()))
        elif sub == P.UI_DRAW["ICON"]: self.val(1); self.val(2); self.val(2); self.val(1); self.val(1)
        elif sub == P.UI_DRAW["STORE"]: self.val(1)
        elif sub == P.UI_DRAW["RESTORE"]: self.val(1)
        else: raise VMError(f"UI_DRAW {sub}")

    def op_UI_BUTTON(self):
        sub = self.val(1); b = self.b
        if sub == P.UI_BUTTON["PRESSED"]:
            btn = self.val(1); r = self.ref()
            name = next((k for k, v in P.BUTTONS.items() if v == btn), None)
            self.write(r, 1 if (name == "any" and any(b.buttons.values())) or b.buttons.get(name) else 0, 1)
        elif sub in (P.UI_BUTTON["SHORTPRESS"], P.UI_BUTTON["LONGPRESS"], P.UI_BUTTON["GET_BUMBED"], P.UI_BUTTON["TESTSHORTPRESS"], P.UI_BUTTON["TESTLONGPRESS"]):
            btn = self.val(1); r = self.ref()
            name = next((k for k, v in P.BUTTONS.items() if v == btn), None)
            self.write(r, 1 if b.buttons.get(name) else 0, 1)
            if b.buttons.get(name): b.buttons[name] = False
        elif sub == P.UI_BUTTON["WAIT_FOR_PRESS"]: pass
        elif sub == P.UI_BUTTON["FLUSH"]: pass
        elif sub == P.UI_BUTTON["GET_HORZ"] or sub == P.UI_BUTTON["GET_VERT"]: self.write(self.ref(), 0, 2)
        else: raise VMError(f"UI_BUTTON {sub}")

    # -- sound
    def op_SOUND(self):
        sub = self.val(1); b = self.b
        if sub == P.SOUND["TONE"]: vol = self.val(1); hz = self.val(2); ms = self.val(2); b.sounds.append(("tone", hz, ms, vol))
        elif sub == P.SOUND["PLAY"]: vol = self.val(1); name = self.val(); b.sounds.append(("file", name, vol))
        elif sub == P.SOUND["REPEAT"]: vol = self.val(1); name = self.val(); b.sounds.append(("repeat", name, vol))
        elif sub == P.SOUND["BREAK"]: b.sounds.append(("stop",))
        else: raise VMError(f"SOUND {sub}")
    def op_SOUND_TEST(self): self.write(self.ref(), 0, 1)
    def op_SOUND_READY(self): pass

    # -- inputs
    def _in(self, no: int):
        if no < 4:
            return self.b.inputs[no]
        if 16 <= no < 20:
            m = self.b.motors[no - 16]
            return dict(type=m["type"], mode=0, values=[float(m["tacho"])])
        return dict(type=126, mode=0, values=[0.0])

    def op_INPUT_DEVICE(self):
        sub = self.val(1)
        if sub == P.INPUT_DEVICE["GET_TYPEMODE"]:
            layer = self.val(1); no = self.val(1); d = self._in(no); self.write(self.ref(), d["type"], 1); self.write(self.ref(), d["mode"], 1)
        elif sub == P.INPUT_DEVICE["READY_SI"] or sub == P.INPUT_DEVICE["READY_RAW"] or sub == P.INPUT_DEVICE["READY_PCT"]:
            layer = self.val(1); no = self.val(1); typ = self.val(1); mode = self.val(1); n = self.val(1)
            d = self._in(no)
            if mode != -1 and no < 4:
                d["mode"] = mode
            vals = d["values"]
            for i in range(n):
                v = vals[i] if i < len(vals) else 0.0
                r = self.ref()
                if sub == P.INPUT_DEVICE["READY_SI"]: self.write(r, v, 4, True)
                else: self.write(r, int(v), 1)
        elif sub == P.INPUT_DEVICE["GET_NAME"]:
            layer = self.val(1); no = self.val(1); n = self.val(1); self.write_str(self.ref(), P.DEVICE_TYPES.get(self._in(no)["type"], "?"), n)
        elif sub == P.INPUT_DEVICE["GET_MODENAME"]:
            layer = self.val(1); no = self.val(1); mode = self.val(1); n = self.val(1); d = self._in(no)
            self.write_str(self.ref(), P.SENSOR_MODES.get(d["type"], {}).get(mode, ("?",))[0], n)
        elif sub == P.INPUT_DEVICE["CLR_ALL"]: self.val(1)
        elif sub == P.INPUT_DEVICE["STOP_ALL"]: self.val(1)
        elif sub == P.INPUT_DEVICE["GET_CONNECTION"]: layer = self.val(1); no = self.val(1); self.write(self.ref(), 0 if self._in(no)["type"] == 126 else 1, 1)
        elif sub == P.INPUT_DEVICE["CLR_CHANGES"]: self.val(1); self.val(1)
        else: raise VMError(f"INPUT_DEVICE {sub}")

    def op_INPUT_READSI(self):
        layer = self.val(1); no = self.val(1); typ = self.val(1); mode = self.val(1); d = self._in(no)
        if mode != -1 and no < 4:
            d["mode"] = mode
        self.write(self.ref(), d["values"][0] if d["values"] else 0.0, 4, True)

    def op_INPUT_READ(self):
        layer = self.val(1); no = self.val(1); typ = self.val(1); mode = self.val(1); d = self._in(no)
        self.write(self.ref(), int(d["values"][0]) if d["values"] else 0, 1)

    def op_INPUT_DEVICE_LIST(self):
        n = self.val(1); r = self.ref(); chg = self.ref()
        for i in range(min(n, 8)):
            r.mem[r.offset + i] = self._in(i if i < 4 else 12 + i)["type"] & 0xFF
        self.write(chg, 0, 1)

    # -- outputs
    def _ports(self, mask):
        return [i for i in range(4) if mask & (1 << i)]

    def op_OUTPUT_GET_TYPE(self): layer = self.val(1); no = self.val(1); self.write(self.ref(), self.b.motors[no]["type"], 1)
    def op_OUTPUT_SET_TYPE(self): self.val(1); no = self.val(1); t = self.val(1); self.b.motors[no]["type"] = t
    def op_OUTPUT_RESET(self): self.val(1); m = self.val(1); [self.b.motors[p].update(tacho=0) for p in self._ports(m)]
    def op_OUTPUT_STOP(self):
        self.val(1); mask = self.val(1); brake = self.val(1)
        for p in self._ports(mask): self.b.motors[p].update(running=False, power=0, speed=0)
        self.b.log.append(f"STOP {mask:x} brake {brake}")
    def op_OUTPUT_POWER(self): self.val(1); mask = self.val(1); pw = self.val(1); [self.b.motors[p].update(power=pw) for p in self._ports(mask)]
    def op_OUTPUT_SPEED(self): self.val(1); mask = self.val(1); sp = self.val(1); [self.b.motors[p].update(speed=sp, power=sp) for p in self._ports(mask)]
    def op_OUTPUT_START(self): self.val(1); mask = self.val(1); [self.b.motors[p].update(running=True) for p in self._ports(mask)]
    def op_OUTPUT_POLARITY(self): self.val(1); mask = self.val(1); pol = self.val(1); [self.b.motors[p].update(polarity=pol) for p in self._ports(mask)]
    def op_OUTPUT_READ(self): self.val(1); no = self.val(1); m = self.b.motors[no]; self.write(self.ref(), m["speed"], 1); self.write(self.ref(), m["tacho"], 4)
    def op_OUTPUT_TEST(self): self.val(1); mask = self.val(1); self.write(self.ref(), 0, 1)
    def op_OUTPUT_READY(self): self.val(1); self.val(1)
    def op_OUTPUT_CLR_COUNT(self): self.val(1); mask = self.val(1); [self.b.motors[p].update(tacho=0) for p in self._ports(mask)]
    def op_OUTPUT_GET_COUNT(self): self.val(1); no = self.val(1); self.write(self.ref(), self.b.motors[no]["tacho"], 4)
    def op_OUTPUT_PRG_STOP(self): pass

    def _step(self, time_based: bool):
        self.val(1); mask = self.val(1); sp = self.val(1); s1 = self.val(4); s2 = self.val(4); s3 = self.val(4); brake = self.val(1)
        for p in self._ports(mask):
            m = self.b.motors[p]
            m.update(speed=sp, power=sp, running=False)
            deg = (s1 + s2 + s3) if not time_based else int(sp * 3.6 * (s1 + s2 + s3) / 1000)
            m["tacho"] += deg if sp >= 0 else -deg
        self.b.log.append(f"{'TIME' if time_based else 'STEP'} {mask:x} speed {sp} {s1}+{s2}+{s3}")
    def op_OUTPUT_STEP_SPEED(self): self._step(False)
    def op_OUTPUT_STEP_POWER(self): self._step(False)
    def op_OUTPUT_TIME_SPEED(self): self._step(True)
    def op_OUTPUT_TIME_POWER(self): self._step(True)

    def _sync(self, time_based: bool):
        self.val(1); mask = self.val(1); sp = self.val(1); turn = self.val(2); step = self.val(4); brake = self.val(1)
        for p in self._ports(mask):
            m = self.b.motors[p]
            m.update(speed=sp, power=sp, running=step == 0)
            deg = step if not time_based else int(sp * 3.6 * step / 1000)
            m["tacho"] += deg if sp >= 0 else -deg
        self.b.log.append(f"{'TIME' if time_based else 'STEP'}_SYNC {mask:x} speed {sp} turn {turn} {step}")
    def op_OUTPUT_STEP_SYNC(self): self._sync(False)
    def op_OUTPUT_TIME_SYNC(self): self._sync(True)

    # -- COM / INFO / FILE
    def op_COM_GET(self):
        sub = self.val(1)
        if sub == P.COM_GET["GET_BRICKNAME"]: n = self.val(1); self.write_str(self.ref(), self.b.name, n)
        elif sub == P.COM_GET["GET_ID"]: hw = self.val(1); n = self.val(1); self.write_str(self.ref(), "001653502163", n)
        elif sub == P.COM_GET["GET_ON_OFF"]: self.val(1); self.write(self.ref(), 1, 1)
        else: raise VMError(f"COM_GET {sub}")

    def op_COM_SET(self):
        sub = self.val(1)
        if sub == P.COM_SET["SET_BRICKNAME"]: self.b.name = str(self.val())[:13]
        elif sub == P.COM_SET["SET_ON_OFF"]: self.val(1); self.val(1)
        elif sub == P.COM_SET["SET_VISIBLE"]: self.val(1); self.val(1)
        else: raise VMError(f"COM_SET {sub}")

    def op_INFO(self):
        sub = self.val(1)
        if sub == P.INFO["GET_VOLUME"]: self.write(self.ref(), self.b.volume, 1)
        elif sub == P.INFO["SET_VOLUME"]: self.b.volume = self.val(1)
        elif sub == P.INFO["GET_MINUTES"]: self.write(self.ref(), self.b.sleep_minutes, 1)
        elif sub == P.INFO["SET_MINUTES"]: self.b.sleep_minutes = self.val(1)
        else: raise VMError(f"INFO {sub}")

    def op_FILE(self):
        sub = self.val(1)
        if sub == P.FILE["LOAD_IMAGE"]:
            slot = self.val(2); name = str(self.val()); size_r = self.ref(); ip_r = self.ref()
            key = name if name in self.b.files else next((k for k in self.b.files if k.endswith(name.lstrip("./"))), None)
            if key is None:
                self.write(size_r, 0, 4); self.write(ip_r, 0, 4)
                raise VMError(f"program not found: {name}")
            self.b.running_program = key
            self.write(size_r, len(self.b.files[key]), 4); self.write(ip_r, 0, 4)
        elif sub == P.FILE["MAKE_FOLDER"]: self.val(); self.write(self.ref(), 1, 1)
        elif sub == P.FILE["REMOVE"]: name = str(self.val()); self.b.files.pop(name, None)
        else: raise VMError(f"FILE {sub}")

    def op_PROGRAM_INFO(self):
        sub = self.val(1); slot = self.val(2)
        if sub == P.PROGRAM_INFO["GET_STATUS"]: self.write(self.ref(), 0x40 if self.b.running_program else 0x10, 1)
        else: raise VMError(f"PROGRAM_INFO {sub}")
