"""High-level RCX API: direct commands, firmware and program download."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Union

from . import protocol as P
from .firmware import FirmwareImage
from .image import CHUNK_TASK, ProgramImage
from .link import RcxLink, ReplyError, RcxError
from .transport import Transport, open_transport

Progress = Optional[Callable[[int, int], None]]

FIRMWARE_CHUNK = 200   # bytes per TransferData while the ROM is in charge
PROGRAM_CHUNK = 20     # bytes per TransferData while the firmware is in charge


@dataclass
class Versions:
    rom: int
    firmware: int

    @property
    def has_firmware(self) -> bool:
        return self.firmware != 0

    # Firmware words seen on real bricks: firm0328.lgo reports 0x00030208.
    KNOWN_FIRMWARE = {0x00030208: "firm0328 (RIS 2.0)"}

    @staticmethod
    def _fmt(v: int) -> str:
        hi, lo = v >> 16, v & 0xFFFF
        return f"{hi:x}.{lo:02x}" if lo <= 0xFF else f"{hi:x}.{lo:04x}"

    def __str__(self) -> str:
        if not self.has_firmware:
            fw = "none"
        else:
            fw = self._fmt(self.firmware)
            if self.firmware in self.KNOWN_FIRMWARE:
                fw += " = " + self.KNOWN_FIRMWARE[self.firmware]
        return f"ROM {self._fmt(self.rom)} ({self.rom:08x}), firmware {fw} ({self.firmware:08x})"


def _motor_bits(motors: Union[str, int]) -> int:
    if isinstance(motors, int):
        return motors & 0x07
    bits = 0
    for ch in motors.upper():
        if ch not in P.MOTOR_BITS:
            raise ValueError(f"unknown motor '{ch}' (use A, B, C)")
        bits |= P.MOTOR_BITS[ch]
    return bits


class RCX:
    """Talk to an RCX through a :class:`RcxLink`."""

    def __init__(self, link: RcxLink):
        self.link = link

    @classmethod
    def open(cls, port: Optional[str] = None, tower: str = "auto",
             verbose: bool = False, usb_range: str = "medium",
             echoes: Optional[bool] = None) -> "RCX":
        """``tower``: 'auto', 'diy', 'serial' or 'usb' (see transport.open_transport)."""
        t = open_transport(port, tower=tower, usb_range=usb_range, echoes=echoes)
        return cls(RcxLink(t, verbose=verbose))

    @classmethod
    def from_transport(cls, transport: Transport, verbose: bool = False) -> "RCX":
        return cls(RcxLink(transport, verbose=verbose))

    def close(self) -> None:
        self.link.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- basics -------------------------------------------------------------
    def ping(self) -> bool:
        self.link.send(bytes([P.ALIVE]))
        return True

    def versions(self) -> Versions:
        r = self.link.send(bytes([P.GET_VERSIONS]) + P.VERSIONS_KEY)
        rom, fw = struct.unpack(">II", r[:8])
        return Versions(rom, fw)

    def battery_mv(self) -> int:
        r = self.link.send(bytes([P.GET_BATTERY]))
        return r[0] | (r[1] << 8)

    def power_off(self) -> None:
        self.link.send(bytes([P.POWER_OFF]))

    def set_power_down_delay(self, minutes: int) -> None:
        self.link.send(bytes([P.SET_POWER_DOWN_DELAY, minutes & 0xFF]))

    def set_tx_range(self, long_range: bool) -> None:
        self.link.send(bytes([P.SET_TX_RANGE, 1 if long_range else 0]))

    def set_time(self, hours: int, minutes: int) -> None:
        self.link.send(bytes([P.SET_TIME, hours % 24, minutes % 60]))

    # -- sound ---------------------------------------------------------------
    def play_sound(self, sound: Union[int, str]) -> None:
        if isinstance(sound, str):
            sound = P.SOUNDS[sound.lower()]
        self.link.send(bytes([P.PLAY_SOUND, sound & 0x07]))

    def play_tone(self, hz: int, duration_cs: int) -> None:
        """Play ``hz`` for ``duration_cs`` hundredths of a second (max 255)."""
        self.link.send(bytes([P.PLAY_TONE, hz & 0xFF, (hz >> 8) & 0xFF,
                              max(1, min(255, duration_cs))]))

    # -- motors -------------------------------------------------------------
    def motor_on(self, motors: Union[str, int]) -> None:
        self.link.send(bytes([P.SET_MOTOR_ON_OFF, _motor_bits(motors) | 0x80]))

    def motor_off(self, motors: Union[str, int]) -> None:
        self.link.send(bytes([P.SET_MOTOR_ON_OFF, _motor_bits(motors) | 0x40]))

    def motor_float(self, motors: Union[str, int]) -> None:
        self.link.send(bytes([P.SET_MOTOR_ON_OFF, _motor_bits(motors)]))

    def motor_direction(self, motors: Union[str, int], direction: str) -> None:
        """``direction`` is 'fwd', 'rev' or 'flip'."""
        code = {"fwd": 0x80, "forward": 0x80, "rev": 0x00, "reverse": 0x00,
                "flip": 0x40, "toggle": 0x40}[direction.lower()]
        self.link.send(bytes([P.SET_MOTOR_DIR, _motor_bits(motors) | code]))

    def motor_power(self, motors: Union[str, int], power: int) -> None:
        self.link.send(bytes([P.SET_MOTOR_POWER, _motor_bits(motors),
                              P.SRC_CONSTANT, max(0, min(7, power))]))

    # -- sensors ------------------------------------------------------------
    def set_sensor_type(self, sensor: int, sensor_type: Union[int, str]) -> None:
        if isinstance(sensor_type, str):
            sensor_type = P.SENSOR_TYPES[sensor_type.lower()]
        self.link.send(bytes([P.SET_SENSOR_TYPE, sensor & 3, sensor_type & 0xFF]))

    def set_sensor_mode(self, sensor: int, mode: Union[int, str], slope: int = 0) -> None:
        if isinstance(mode, str):
            mode = P.SENSOR_MODES[mode.lower()]
        self.link.send(bytes([P.SET_SENSOR_MODE, sensor & 3,
                              ((mode & 7) << 5) | (slope & 0x1F)]))

    def configure_sensor(self, sensor: int, sensor_type: Union[int, str],
                         mode: Union[int, str, None] = None) -> None:
        """Set type and a sensible default mode (NQC's SENSOR_* presets)."""
        if isinstance(sensor_type, str):
            sensor_type = P.SENSOR_TYPES[sensor_type.lower()]
        if mode is None:
            mode = {1: "bool", 2: "celsius", 3: "percent", 4: "rotation"}.get(sensor_type, "raw")
        self.set_sensor_type(sensor, sensor_type)
        self.set_sensor_mode(sensor, mode)

    def clear_sensor(self, sensor: int) -> None:
        self.link.send(bytes([P.CLEAR_SENSOR, sensor & 3]))

    # -- values -------------------------------------------------------------
    def get_value(self, source: int, index: int) -> int:
        r = self.link.send(bytes([P.GET_VALUE, source & 0xFF, index & 0xFF]))
        return struct.unpack("<h", r[:2])[0]

    def sensor_value(self, sensor: int) -> int:
        return self.get_value(P.SRC_SENSOR_VALUE, sensor)

    def sensor_raw(self, sensor: int) -> int:
        return self.get_value(P.SRC_SENSOR_RAW, sensor)

    def sensor_bool(self, sensor: int) -> bool:
        return bool(self.get_value(P.SRC_SENSOR_BOOL, sensor))

    def variable(self, index: int) -> int:
        return self.get_value(P.SRC_VARIABLE, index)

    def set_variable(self, index: int, value: int) -> None:
        self.link.send(bytes([P.SET_VARIABLE, index & 0x1F, P.SRC_CONSTANT])
                       + struct.pack("<h", value))

    def timer(self, index: int) -> int:
        return self.get_value(P.SRC_TIMER, index)

    def clear_timer(self, index: int) -> None:
        self.link.send(bytes([P.CLEAR_TIMER, index & 3]))

    def motor_status(self, motor: int) -> int:
        return self.get_value(P.SRC_MOTOR_STATUS, motor)

    def current_program(self) -> int:
        return self.get_value(P.SRC_PROGRAM, 0)

    def watch(self) -> int:
        """Minutes since power on (the RCX clock)."""
        return self.get_value(P.SRC_WATCH, 0)

    def message(self) -> int:
        return self.get_value(P.SRC_MESSAGE, 0)

    def set_message(self, value: int) -> None:
        """Deliver an IR message (what another RCX's SendMessage would do)."""
        self.link.send(bytes([P.SET_MESSAGE, value & 0xFF]))

    # -- display ------------------------------------------------------------
    def set_display(self, what: Union[int, str]) -> None:
        """0/'watch', 1-3 sensors ('1'..'3'), 4-6 motors ('A'..'C')."""
        if isinstance(what, str):
            w = what.strip().lower()
            what = {"watch": 0, "1": 1, "2": 2, "3": 3, "a": 4, "b": 5, "c": 6}[w]
        self.link.send(bytes([P.SET_DISPLAY, P.SRC_CONSTANT, what & 0xFF, 0]))

    # -- programs & tasks ---------------------------------------------------
    def select_program(self, number: int) -> None:
        """Select program slot 0..4 (shown as 1..5 on the RCX)."""
        self.link.send(bytes([P.SET_PROGRAM, number & 0x07]))

    def start_task(self, task: int = 0) -> None:
        self.link.send(bytes([P.START_TASK, task & 0x0F]))

    def stop_task(self, task: int) -> None:
        self.link.send(bytes([P.STOP_TASK, task & 0x0F]))

    def stop_all(self) -> None:
        self.link.send(bytes([P.STOP_ALL_TASKS]))

    def delete_all_tasks(self) -> None:
        self.link.send(bytes([P.DELETE_ALL_TASKS]))

    def delete_all_subs(self) -> None:
        self.link.send(bytes([P.DELETE_ALL_SUBS]))

    def delete_task(self, task: int) -> None:
        self.link.send(bytes([P.DELETE_TASK, task & 0x0F]))

    def delete_sub(self, sub: int) -> None:
        self.link.send(bytes([P.DELETE_SUB, sub & 0x0F]))

    # -- memory / datalog ---------------------------------------------------
    def memory_map(self) -> list:
        r = self.link.send(bytes([P.GET_MEMORY_MAP]))
        return list(struct.unpack(">94H", r[:188]))

    def set_datalog_size(self, size: int) -> None:
        self.link.send_checked(bytes([P.SET_DATALOG_SIZE, size & 0xFF, size >> 8]))

    def upload_datalog(self, first: int = 0, count: Optional[int] = None) -> list:
        if count is None:
            # entry 0 holds the current size
            size = self.upload_datalog(0, 1)[0][1]
            first, count = 1, max(0, size - 1)
            if count == 0:
                return []
        r = self.link.send(bytes([P.UPLOAD_DATALOG, first & 0xFF, first >> 8,
                                  count & 0xFF, count >> 8]))
        out = []
        for i in range(0, len(r) - 2, 3):
            kind = r[i]
            value = struct.unpack("<h", r[i + 1:i + 3])[0]
            out.append((kind, value))
        return out

    # -- raw ----------------------------------------------------------------
    def raw(self, body: bytes, expect: Optional[int] = None) -> bytes:
        return self.link.send(body, expect=expect)

    # -- firmware -----------------------------------------------------------
    def download_firmware(self, image: FirmwareImage, progress: Progress = None) -> None:
        """Install firmware (same sequence NQC/firmdl3 use).

        The brick must have no firmware (fresh batteries or 'firmware delete');
        we send DeleteFirmware first so a half-installed image is cleared too.
        """
        self.ping()
        self.link.send(bytes([P.DELETE_FIRMWARE]) + P.DELETE_FIRMWARE_KEY)
        start, ck = image.start, image.checksum
        r = self.link.send(bytes([P.BEGIN_FIRMWARE, start & 0xFF, start >> 8,
                                  ck & 0xFF, ck >> 8, 0]))
        if r and r[0] != 0:
            raise ReplyError(P.BEGIN_FIRMWARE, r[0], f"BeginFirmware refused (error {r[0]})")
        self.link.download(image.data, FIRMWARE_CHUNK, self.link.DOWNLOAD_TIMEOUT, progress)
        reply = self.link.send(bytes([P.UNLOCK_FIRMWARE]) + P.UNLOCK_KEY,
                               timeout=self.link.UNLOCK_TIMEOUT, retries=1)
        if reply != P.UNLOCK_REPLY:
            raise RcxError(f"unexpected unlock reply: {reply!r}")

    def delete_firmware(self) -> None:
        self.ping()
        self.link.send(bytes([P.DELETE_FIRMWARE]) + P.DELETE_FIRMWARE_KEY)

    # -- programs -----------------------------------------------------------
    def download_program(self, image: ProgramImage, program: int = 0,
                         progress: Progress = None, beep: bool = True) -> None:
        """Download an NQC image into program slot ``program`` (0..4)."""
        self.ping()
        self.stop_all()
        self.select_program(program)
        self.delete_all_tasks()
        self.delete_all_subs()
        total = image.size
        done = 0

        def _prog(pos: int, _chunk_total: int, base=None) -> None:
            if progress:
                progress(base + pos, total)

        for chunk in image.chunks:
            op = P.BEGIN_TASK if chunk.type == CHUNK_TASK else P.BEGIN_SUB
            n = len(chunk.data)
            r = self.link.send(bytes([op, 0, chunk.number, 0, n & 0xFF, n >> 8]))
            if not r or r[0] != 0:
                code = r[0] if r else -1
                why = {1: "not enough memory", 2: "invalid task/sub number"}.get(code, f"error {code}")
                raise ReplyError(op, code, f"cannot start {chunk.kind} {chunk.number} download: {why}")
            base = done
            self.link.download(chunk.data, PROGRAM_CHUNK, self.link.DOWNLOAD_TIMEOUT,
                               (lambda pos, t, b=base: _prog(pos, t, b)) if progress else None)
            done += n
        if beep:
            self.play_sound(5)


def iter_motor_names(bits: int) -> Iterable[str]:
    for name, bit in P.MOTOR_BITS.items():
        if bits & bit:
            yield name
