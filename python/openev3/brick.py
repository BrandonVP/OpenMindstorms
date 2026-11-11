"""High-level EV3 API: direct commands, files, programs."""

from __future__ import annotations

import logging
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Union

from . import protocol as P
from .protocol import GV, LC, LC0, LC1, LC2, LC4, LCF, LCS, op
from .transport import Transport, open_transport

log = logging.getLogger("openev3")
Progress = Optional[Callable[[int, int], None]]
PRJS = "../prjs/"


@dataclass
class BrickInfo:
    name: str
    firmware: str
    hardware: str
    os: str
    battery_v: float
    battery_pct: int


@dataclass
class Device:
    port: str          # '1'..'4' or 'A'..'D'
    no: int            # 0..3 inputs, 16..19 outputs
    type: int
    mode: int

    @property
    def type_name(self) -> str:
        return P.DEVICE_TYPES.get(self.type, f"type {self.type}")

    @property
    def present(self) -> bool:
        return self.type not in (126, 125, 127)

    @property
    def modes(self) -> Dict[int, Tuple[str, str, int]]:
        return P.SENSOR_MODES.get(self.type, {})


class EV3:
    def __init__(self, transport: Transport, verbose: bool = False, timeout: float = 2.0):
        self.t = transport
        self.verbose = verbose
        self.timeout = timeout
        self.counter = 0
        self.stats = {"sent": 0, "errors": 0}

    @classmethod
    def open(cls, spec: Optional[str] = None, verbose: bool = False) -> "EV3":
        return cls(open_transport(spec), verbose=verbose)

    def close(self) -> None:
        self.t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ------------------------------------------------------------- core
    def _exchange(self, msg: bytes, reply: bool, timeout: Optional[float]) -> Optional[bytes]:
        self.stats["sent"] += 1
        if self.verbose:
            log.info("TX %s", P.hexs(msg))
        self.t.send(msg)
        if not reply:
            return None
        deadline = time.monotonic() + (timeout or self.timeout)
        while True:
            data = self.t.recv(max(0.01, deadline - time.monotonic()))
            if data is None:
                self.stats["errors"] += 1
                raise TimeoutError("no reply from the EV3 (is it on and connected?)")
            if self.verbose:
                log.info("RX %s", P.hexs(data[:64]) + (" ..." if len(data) > 64 else ""))
            counter, typ, rest = P.parse_message(data)
            if counter == self.counter:
                return bytes([typ]) + rest
            if time.monotonic() >= deadline:
                self.stats["errors"] += 1
                raise TimeoutError("reply counter mismatch")

    def direct(self, bytecodes: bytes, globals_: int = 0, locals_: int = 0, reply: bool = True,
               timeout: Optional[float] = None) -> bytes:
        """Run bytecodes as a direct command; returns the global memory."""
        self.counter = (self.counter + 1) & 0xFFFF
        msg = P.direct_command(bytecodes, globals_, locals_, self.counter, reply)
        r = self._exchange(msg, reply, timeout)
        if r is None:
            return b""
        if r[0] == P.REPLY_DIRECT_ERROR:
            self.stats["errors"] += 1
            raise P.EV3Error("the brick reported an error running the direct command")
        return r[1:]

    def system(self, command: int, payload: bytes = b"", reply: bool = True,
               ok: Tuple[int, ...] = (0,), timeout: Optional[float] = None) -> Tuple[int, bytes]:
        self.counter = (self.counter + 1) & 0xFFFF
        msg = P.system_command(command, payload, self.counter, reply)
        r = self._exchange(msg, reply, timeout)
        if r is None:
            return 0, b""
        cmd, status = r[1], r[2]
        if status not in ok:
            self.stats["errors"] += 1
            raise P.EV3Error(f"system command 0x{command:02X} failed: {P.SYSTEM_STATUS.get(status, status)}")
        return status, r[3:]

    # ------------------------------------------------------------- identity
    def info(self) -> BrickInfo:
        bc = (op("UI_READ", LC0(P.UI_READ["GET_FW_VERS"]), LC0(16), GV(0))
              + op("UI_READ", LC0(P.UI_READ["GET_VBATT"]), GV(16))
              + op("UI_READ", LC0(P.UI_READ["GET_LBATT"]), GV(20))
              + op("UI_READ", LC0(P.UI_READ["GET_OS_VERS"]), LC0(16), GV(21))
              + op("UI_READ", LC0(P.UI_READ["GET_HW_VERS"]), LC0(8), GV(37))
              + op("COM_GET", LC0(P.COM_GET["GET_BRICKNAME"]), LC0(16), GV(45)))
        g = self.direct(bc, 61)
        cstr = lambda b: b.split(b"\x00")[0].decode("ascii", "replace")
        return BrickInfo(cstr(g[45:61]), cstr(g[0:16]), cstr(g[37:45]), cstr(g[21:37]),
                         struct.unpack_from("<f", g, 16)[0], g[20])

    def battery(self) -> Tuple[float, int]:
        g = self.direct(op("UI_READ", LC0(P.UI_READ["GET_VBATT"]), GV(0)) + op("UI_READ", LC0(P.UI_READ["GET_LBATT"]), GV(4)), 5)
        return struct.unpack_from("<f", g, 0)[0], g[4]

    def name(self) -> str:
        g = self.direct(op("COM_GET", LC0(P.COM_GET["GET_BRICKNAME"]), LC0(16), GV(0)), 16)
        return g.split(b"\x00")[0].decode("ascii", "replace")

    def set_name(self, name: str) -> None:
        self.direct(op("COM_SET", LC0(P.COM_SET["SET_BRICKNAME"]), LCS(name[:13])))

    def volume(self) -> int:
        return self.direct(op("INFO", LC0(P.INFO["GET_VOLUME"]), GV(0)), 1)[0]

    def set_volume(self, pct: int) -> None:
        self.direct(op("INFO", LC0(P.INFO["SET_VOLUME"]), LC1(max(0, min(100, pct)))))

    def sleep_minutes(self) -> int:
        return self.direct(op("INFO", LC0(P.INFO["GET_MINUTES"]), GV(0)), 1)[0]

    def set_sleep_minutes(self, minutes: int) -> None:
        self.direct(op("INFO", LC0(P.INFO["SET_MINUTES"]), LC1(minutes)))

    # ------------------------------------------------------------- sound, LED, display
    def play_tone(self, hz: int, ms: int, volume: int = 50, reply: bool = False) -> None:
        self.direct(op("SOUND", LC0(P.SOUND["TONE"]), LC1(volume), LC2(hz), LC2(ms)), reply=reply)

    def play_file(self, name: str, volume: int = 50, repeat: bool = False) -> None:
        """A .rsf sound file on the brick, path without extension (e.g. '../prjs/Sounds/Hello')."""
        sub = P.SOUND["REPEAT"] if repeat else P.SOUND["PLAY"]
        self.direct(op("SOUND", LC0(sub), LC1(volume), LCS(name)), reply=False)

    def stop_sound(self) -> None:
        self.direct(op("SOUND", LC0(P.SOUND["BREAK"])), reply=False)

    def led(self, pattern: Union[int, str]) -> None:
        if isinstance(pattern, str):
            pattern = P.LED_PATTERNS[pattern.lower().replace("-", "_")]
        self.direct(op("UI_WRITE", LC0(P.UI_WRITE["LED"]), LC0(pattern)), reply=False)

    def display_text(self, lines: Union[str, List[str]], font: int = 1, clear: bool = True) -> None:
        """Write text lines (up to 10 with the normal font) and refresh the screen."""
        if isinstance(lines, str):
            lines = lines.split("\n")
        bc = b""
        if clear:
            bc += op("UI_DRAW", LC0(P.UI_DRAW["FILLWINDOW"]), LC0(0), LC0(0), LC0(0))
        bc += op("UI_DRAW", LC0(P.UI_DRAW["SELECT_FONT"]), LC0(font))
        step = {0: 9, 1: 12, 2: 18}[font]
        for i, line in enumerate(lines[:12]):
            bc += op("UI_DRAW", LC0(P.UI_DRAW["TEXT"]), LC0(1), LC(2), LC(2 + i * step), LCS(line[:30]))
        bc += op("UI_DRAW", LC0(P.UI_DRAW["UPDATE"]))
        self.direct(bc, reply=False)

    def display_clear(self) -> None:
        self.direct(op("UI_DRAW", LC0(P.UI_DRAW["FILLWINDOW"]), LC0(0), LC0(0), LC0(0)) + op("UI_DRAW", LC0(P.UI_DRAW["UPDATE"])), reply=False)

    def buttons(self) -> Dict[str, bool]:
        names = ["up", "enter", "down", "right", "left", "back"]
        bc = b"".join(op("UI_BUTTON", LC0(P.UI_BUTTON["PRESSED"]), LC0(P.BUTTONS[n]), GV(i)) for i, n in enumerate(names))
        g = self.direct(bc, len(names))
        return {n: bool(g[i]) for i, n in enumerate(names)}

    # ------------------------------------------------------------- devices
    def devices(self) -> List[Device]:
        nos = [0, 1, 2, 3, 16, 17, 18, 19]
        bc = b"".join(op("INPUT_DEVICE", LC0(P.INPUT_DEVICE["GET_TYPEMODE"]), LC0(0), LC0(no), GV(i * 2), GV(i * 2 + 1)) for i, no in enumerate(nos))
        g = self.direct(bc, 16)
        labels = ["1", "2", "3", "4", "A", "B", "C", "D"]
        return [Device(labels[i], no, g[i * 2], g[i * 2 + 1]) for i, no in enumerate(nos)]

    def sensor_read(self, port: Union[int, str], mode: Optional[int] = None, values: int = 1) -> List[float]:
        """SI values from input port 1..4 (or motor 'A'..'D' for degrees); mode None keeps the current one."""
        no = self._no(port)
        m = -1 if mode is None else mode
        bc = op("INPUT_DEVICE", LC0(P.INPUT_DEVICE["READY_SI"]), LC0(0), LC(no), LC0(0), LC0(m), LC0(values), *[GV(i * 4) for i in range(values)])
        g = self.direct(bc, values * 4, timeout=5.0)
        return [struct.unpack_from("<f", g, i * 4)[0] for i in range(values)]

    def sensor_value(self, port, mode: Optional[int] = None) -> float:
        return self.sensor_read(port, mode, 1)[0]

    def sensor_name(self, port) -> Tuple[str, str]:
        no = self._no(port)
        g = self.direct(op("INPUT_DEVICE", LC0(P.INPUT_DEVICE["GET_NAME"]), LC0(0), LC(no), LC0(16), GV(0))
                        + op("INPUT_DEVICE", LC0(P.INPUT_DEVICE["GET_TYPEMODE"]), LC0(0), LC(no), GV(16), GV(17)), 18)
        name = g[:16].split(b"\x00")[0].decode("ascii", "replace").strip()
        return name, P.DEVICE_TYPES.get(g[16], str(g[16]))

    @staticmethod
    def _no(port) -> int:
        s = str(port).upper()
        if s in "ABCD" and s:
            return 16 + "ABCD".index(s)
        n = int(s)
        if 1 <= n <= 4:
            return n - 1
        raise ValueError("port must be 1..4 or A..D")

    # ------------------------------------------------------------- motors
    def motor_power(self, ports, power: int, reply: bool = False) -> None:
        """Run unregulated at power -100..100 until stopped."""
        m = P.port_mask(ports)
        self.direct(op("OUTPUT_POWER", LC0(0), LC0(m), LC(power)) + op("OUTPUT_START", LC0(0), LC0(m)), reply=reply)

    def motor_speed(self, ports, speed: int, reply: bool = False) -> None:
        """Run speed-regulated at -100..100 until stopped."""
        m = P.port_mask(ports)
        self.direct(op("OUTPUT_SPEED", LC0(0), LC0(m), LC(speed)) + op("OUTPUT_START", LC0(0), LC0(m)), reply=reply)

    def motor_stop(self, ports="ABCD", brake: bool = True, reply: bool = False) -> None:
        self.direct(op("OUTPUT_STOP", LC0(0), LC0(P.port_mask(ports)), LC0(1 if brake else 0)), reply=reply)

    def motor_degrees(self, ports, speed: int, degrees: int, brake: bool = True, ramp: int = 0, wait: bool = False) -> None:
        m = P.port_mask(ports)
        bc = op("OUTPUT_STEP_SPEED", LC0(0), LC0(m), LC(speed), LC(ramp), LC(max(0, abs(degrees) - 2 * ramp)), LC(ramp), LC0(1 if brake else 0))
        if degrees < 0:
            bc = op("OUTPUT_STEP_SPEED", LC0(0), LC0(m), LC(-speed), LC(ramp), LC(max(0, abs(degrees) - 2 * ramp)), LC(ramp), LC0(1 if brake else 0))
        if wait:
            bc += op("OUTPUT_READY", LC0(0), LC0(m))
        self.direct(bc, reply=wait, timeout=60.0 if wait else None)

    def motor_time(self, ports, speed: int, ms: int, brake: bool = True, wait: bool = False) -> None:
        m = P.port_mask(ports)
        bc = op("OUTPUT_TIME_SPEED", LC0(0), LC0(m), LC(speed), LC(0), LC(ms), LC(0), LC0(1 if brake else 0))
        if wait:
            bc += op("OUTPUT_READY", LC0(0), LC0(m))
        self.direct(bc, reply=wait, timeout=ms / 1000 + 5 if wait else None)

    def drive(self, ports="BC", speed: int = 50, turn: int = 0, degrees: int = 0, ms: int = 0,
              brake: bool = True, wait: bool = False) -> None:
        """Two motors in sync (EV3-G Move Steering).  turn -200..200: 0 straight, 100 one wheel stopped, 200 spin.
        degrees/ms 0 = keep going."""
        m = P.port_mask(ports)
        if ms:
            bc = op("OUTPUT_TIME_SYNC", LC0(0), LC0(m), LC(speed), LC2(turn), LC4(ms), LC0(1 if brake else 0))
        else:
            bc = op("OUTPUT_STEP_SYNC", LC0(0), LC0(m), LC(speed), LC2(turn), LC4(abs(degrees)), LC0(1 if brake else 0))
        if wait and (ms or degrees):
            bc += op("OUTPUT_READY", LC0(0), LC0(m))
        self.direct(bc, reply=wait and bool(ms or degrees), timeout=60.0)

    def motor_position(self, port) -> int:
        g = self.direct(op("OUTPUT_GET_COUNT", LC0(0), LC0(P.port_index(port)), GV(0)), 4)
        return struct.unpack_from("<i", g, 0)[0]

    def motor_reset(self, ports="ABCD") -> None:
        self.direct(op("OUTPUT_CLR_COUNT", LC0(0), LC0(P.port_mask(ports))), reply=False)

    def motor_busy(self, ports) -> bool:
        g = self.direct(op("OUTPUT_TEST", LC0(0), LC0(P.port_mask(ports)), GV(0)), 1)
        return bool(g[0])

    def motor_state(self, port) -> Tuple[int, int]:
        """(speed, tacho) of one motor."""
        g = self.direct(op("OUTPUT_READ", LC0(0), LC0(P.port_index(port)), GV(0), GV(4)), 8)
        return struct.unpack_from("<b", g, 0)[0], struct.unpack_from("<i", g, 4)[0]

    # ------------------------------------------------------------- programs
    def run_program(self, path: str) -> None:
        """Start an .rbf, e.g. '../prjs/BrkProg_SAVE/Demo.rpf' or 'MyProject/Program.rbf'."""
        if not path.startswith("../") and not path.startswith("/"):
            path = PRJS + path
        bc = (op("FILE", LC0(P.FILE["LOAD_IMAGE"]), LC2(P.USER_SLOT), LCS(path), GV(0), GV(4))
              + op("PROGRAM_START", LC2(P.USER_SLOT), GV(0), GV(4), LC0(0)))
        self.direct(bc, 8)

    def stop_program(self) -> None:
        self.direct(op("PROGRAM_STOP", LC2(P.USER_SLOT)), reply=False)

    def program_running(self) -> bool:
        g = self.direct(op("PROGRAM_INFO", LC0(P.PROGRAM_INFO["GET_STATUS"]), LC2(P.USER_SLOT), GV(0)), 1)
        return g[0] == 0x40

    # ------------------------------------------------------------- files
    def list_files(self, path: str = PRJS) -> List[dict]:
        if not path.endswith("/"):
            path += "/"
        status, d = self.system(P.LIST_FILES, struct.pack("<H", 1000) + path.encode() + b"\x00", ok=(0, 8))
        size = struct.unpack_from("<I", d, 0)[0]
        handle = d[4]
        text = d[5:]
        while len(text) < size and status != 8:
            status, d = self.system(P.CONTINUE_LIST_FILES, bytes([handle]) + struct.pack("<H", 1000), ok=(0, 8))
            handle = d[0]
            text += d[1:]
        return P.parse_file_listing(text.decode("utf-8", "replace"))

    def upload(self, path: str, data: bytes, progress: Progress = None) -> None:
        """Write a file to the brick, e.g. '../prjs/OpenEV3/prog.rbf' (folders are created)."""
        if not path.startswith("../") and not path.startswith("/"):
            path = PRJS + path
        status, d = self.system(P.BEGIN_DOWNLOAD, struct.pack("<I", len(data)) + path.encode() + b"\x00")
        handle = d[0]
        chunk = 1000
        pos = 0
        while pos < len(data):
            part = data[pos:pos + chunk]
            status, d = self.system(P.CONTINUE_DOWNLOAD, bytes([handle]) + part, ok=(0, 8))
            pos += len(part)
            if progress:
                progress(pos, len(data))
        if not data:
            self.system(P.CONTINUE_DOWNLOAD, bytes([handle]), ok=(0, 8))

    def upload_file(self, local: Union[str, Path], remote: Optional[str] = None, progress: Progress = None) -> str:
        local = Path(local)
        remote = remote or (PRJS + "OpenEV3/" + local.name)
        self.upload(remote, local.read_bytes(), progress)
        return remote

    def download(self, path: str, progress: Progress = None) -> bytes:
        if not path.startswith("../") and not path.startswith("/"):
            path = PRJS + path
        status, d = self.system(P.BEGIN_UPLOAD, struct.pack("<H", 1000) + path.encode() + b"\x00", ok=(0, 8))
        size = struct.unpack_from("<I", d, 0)[0]
        handle = d[4]
        out = bytearray(d[5:])
        while len(out) < size and status != 8:
            status, d = self.system(P.CONTINUE_UPLOAD, bytes([handle]) + struct.pack("<H", 1000), ok=(0, 8))
            handle = d[0]
            out += d[1:]
            if progress:
                progress(len(out), size)
        return bytes(out[:size])

    def delete(self, path: str) -> None:
        if not path.startswith("../") and not path.startswith("/"):
            path = PRJS + path
        self.system(P.DELETE_FILE, path.encode() + b"\x00")

    def mkdir(self, path: str) -> None:
        if not path.startswith("../") and not path.startswith("/"):
            path = PRJS + path
        self.system(P.CREATE_DIR, path.encode() + b"\x00")

    def keep_alive(self) -> int:
        return self.direct(op("KEEP_ALIVE", GV(0)), 1)[0]
