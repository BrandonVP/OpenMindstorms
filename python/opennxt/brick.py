"""High-level NXT API: direct commands, files, program upload."""

from __future__ import annotations

import logging
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Tuple, Union

from . import protocol as P
from .transport import Transport, open_transport

log = logging.getLogger("opennxt")
Progress = Optional[Callable[[int, int], None]]


@dataclass
class DeviceInfo:
    name: str
    bt_address: str
    bt_signal: int
    free_flash: int


@dataclass
class OutputState:
    port: int
    power: int
    mode: int
    regulation: int
    turn_ratio: int
    run_state: int
    tacho_limit: int
    tacho_count: int
    block_tacho_count: int
    rotation_count: int

    @property
    def running(self) -> bool:
        return bool(self.mode & P.MOTOR_ON) and self.run_state != P.RUN_IDLE


@dataclass
class InputValues:
    port: int
    valid: bool
    calibrated: bool
    sensor_type: int
    sensor_mode: int
    raw: int
    normalized: int
    scaled: int
    calibrated_value: int

    @property
    def type_name(self) -> str:
        return P.SENSOR_TYPE_NAMES.get(self.sensor_type, hex(self.sensor_type))

    @property
    def mode_name(self) -> str:
        return P.SENSOR_MODE_NAMES.get(self.sensor_mode & 0xE0, hex(self.sensor_mode))


class NXT:
    def __init__(self, transport: Transport, verbose: bool = False, timeout: float = 1.0):
        self.t = transport
        self.verbose = verbose
        self.timeout = timeout
        self.stats = {"sent": 0, "errors": 0}

    @classmethod
    def open(cls, spec: Optional[str] = None, verbose: bool = False) -> "NXT":
        return cls(open_transport(spec), verbose=verbose)

    def close(self) -> None:
        self.t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ------------------------------------------------------------- core
    def call(self, msg_type: int, command: int, payload: bytes = b"",
             ok_statuses: Tuple[int, ...] = (0,), timeout: Optional[float] = None) -> Tuple[int, bytes]:
        """Send a command.  Returns (status, reply payload); raises NxtError on a
        status that is not in ``ok_statuses``.  No-reply types return (0, b'')."""
        msg = P.build(msg_type, command, payload)
        self.stats["sent"] += 1
        if self.verbose:
            log.info("TX %s", P.hexs(msg))
        self.t.send(msg)
        if msg_type & 0x80:
            return 0, b""
        deadline = time.monotonic() + (timeout or self.timeout)
        while True:
            reply = self.t.recv(max(0.01, deadline - time.monotonic()))
            if reply is None:
                self.stats["errors"] += 1
                raise TimeoutError(f"no reply to {P.command_name(command)} within {timeout or self.timeout:.1f} s")
            if self.verbose:
                log.info("RX %s", P.hexs(reply))
            if len(reply) >= 2 and reply[0] == P.REPLY and reply[1] == command:
                break
            # stale reply from an earlier command: keep reading until the deadline
            if time.monotonic() >= deadline:
                self.stats["errors"] += 1
                raise TimeoutError(f"unexpected reply to {P.command_name(command)}: {P.hexs(reply)}")
        _, status, data = P.parse_reply(reply)
        if status not in ok_statuses:
            self.stats["errors"] += 1
            raise P.NxtError(command, status)
        return status, data

    def direct(self, command: int, payload: bytes = b"", reply: bool = True, **kw) -> bytes:
        return self.call(P.DIRECT if reply else P.DIRECT_NOREPLY, command, payload, **kw)[1]

    def system(self, command: int, payload: bytes = b"", **kw) -> bytes:
        return self.call(P.SYSTEM, command, payload, **kw)[1]

    # ------------------------------------------------------------- identity
    def device_info(self) -> DeviceInfo:
        d = self.system(P.GET_DEVICE_INFO)
        name = P.cstr(d[:15])
        bt = ":".join(f"{b:02X}" for b in d[15:21])
        signal, free = struct.unpack("<II", d[22:30])
        return DeviceInfo(name, bt, signal, free)

    def firmware_version(self) -> Tuple[str, str]:
        d = self.system(P.GET_FIRMWARE_VERSION)
        return f"{d[1]}.{d[0]:02d}", f"{d[3]}.{d[2]:02d}"   # (protocol, firmware)

    def set_brick_name(self, name: str) -> None:
        b = name.encode("ascii", "replace")[:15]
        self.system(P.SET_BRICK_NAME, b + b"\x00" * (16 - len(b)))

    def battery_mv(self) -> int:
        return struct.unpack("<H", self.direct(P.GET_BATTERY_LEVEL)[:2])[0]

    def keep_alive(self) -> int:
        """Reset the brick's sleep timer; returns the sleep limit in ms."""
        return struct.unpack("<I", self.direct(P.KEEP_ALIVE)[:4])[0]

    # ------------------------------------------------------------- sound
    def play_tone(self, hz: int, ms: int, reply: bool = True) -> None:
        self.direct(P.PLAY_TONE, struct.pack("<HH", max(200, min(14000, hz)), max(1, ms)), reply=reply)

    def play_sound_file(self, name: str, loop: bool = False) -> None:
        self.direct(P.PLAY_SOUND_FILE, bytes([1 if loop else 0]) + P.name20(name))

    def stop_sound(self) -> None:
        self.direct(P.STOP_SOUND_PLAYBACK)

    # ------------------------------------------------------------- motors
    def set_output_state(self, port, power: int, mode: int, regulation: int,
                         turn_ratio: int = 0, run_state: int = P.RUN_RUNNING,
                         tacho_limit: int = 0, reply: bool = True) -> None:
        payload = struct.pack("<BbBBbBI", P.motor_port(port), max(-100, min(100, power)), mode,
                              regulation, max(-100, min(100, turn_ratio)), run_state, tacho_limit)
        self.direct(P.SET_OUTPUT_STATE, payload, reply=reply)

    def motor_run(self, port, power: int = 75, degrees: int = 0, regulated: bool = True,
                  brake: bool = True, reply: bool = True) -> None:
        """Run a motor at ``power`` (-100..100); ``degrees`` 0 = until stopped."""
        mode = P.MOTOR_ON | (P.MOTOR_BRAKE if brake else 0) | (P.MOTOR_REGULATED if regulated else 0)
        reg = P.REGULATION_SPEED if regulated else P.REGULATION_IDLE
        self.set_output_state(port, power, mode, reg, 0, P.RUN_RUNNING, abs(degrees), reply=reply)

    def motors_sync(self, power: int = 75, turn_ratio: int = 0, degrees: int = 0,
                    ports=("B", "C"), brake: bool = True) -> None:
        """Drive two motors in sync (NXT-G Move block).  turn_ratio -100..100."""
        mode = P.MOTOR_ON | (P.MOTOR_BRAKE if brake else 0) | P.MOTOR_REGULATED
        for p in ports:
            self.set_output_state(p, power, mode, P.REGULATION_SYNC, turn_ratio, P.RUN_RUNNING, abs(degrees))

    def motor_stop(self, port, brake: bool = True, reply: bool = True) -> None:
        if brake:
            self.set_output_state(port, 0, P.MOTOR_ON | P.MOTOR_BRAKE | P.MOTOR_REGULATED,
                                  P.REGULATION_SPEED, 0, P.RUN_RUNNING, 0, reply=reply)
        else:
            self.set_output_state(port, 0, 0, P.REGULATION_IDLE, 0, P.RUN_IDLE, 0, reply=reply)

    def motors_stop(self, brake: bool = True) -> None:
        self.motor_stop(P.PORT_ALL, brake)

    def get_output_state(self, port) -> OutputState:
        d = self.direct(P.GET_OUTPUT_STATE, bytes([P.motor_port(port)]))
        f = struct.unpack("<BbBBbBIiii", d[:22])
        return OutputState(*f)

    def reset_motor_position(self, port, relative: bool = False) -> None:
        self.direct(P.RESET_MOTOR_POSITION, bytes([P.motor_port(port), 1 if relative else 0]))

    # ------------------------------------------------------------- sensors
    def set_input_mode(self, port, sensor_type, mode=None) -> None:
        t = P.sensor_type_code(sensor_type)
        if mode is None:
            tname = "ultrasonic" if sensor_type == "ultrasonic" else P.SENSOR_TYPE_NAMES.get(t, "none")
            mode = P.DEFAULT_MODE.get(tname, "raw")
        self.direct(P.SET_INPUT_MODE, bytes([P.sensor_port(port), t, P.sensor_mode_code(mode)]))

    def get_input_values(self, port) -> InputValues:
        d = self.direct(P.GET_INPUT_VALUES, bytes([P.sensor_port(port)]))
        f = struct.unpack("<B??BBHHhh", d[:13])
        return InputValues(*f)

    def sensor_value(self, port) -> int:
        return self.get_input_values(port).scaled

    def reset_scaled_value(self, port) -> None:
        self.direct(P.RESET_INPUT_SCALED_VALUE, bytes([P.sensor_port(port)]))

    # -- I2C (digital) sensors: ultrasonic --------------------------------
    def ls_write(self, port, tx: bytes, rx_len: int) -> None:
        self.direct(P.LS_WRITE, bytes([P.sensor_port(port), len(tx), rx_len]) + tx)

    def ls_status(self, port) -> int:
        status, d = self.call(P.DIRECT, P.LS_GET_STATUS, bytes([P.sensor_port(port)]), ok_statuses=(0, 0x20))
        return -1 if status == 0x20 else d[0]

    def ls_read(self, port) -> bytes:
        d = self.direct(P.LS_READ, bytes([P.sensor_port(port)]))
        n = d[0]
        return bytes(d[1:1 + n])

    def ultrasonic_setup(self, port) -> None:
        self.set_input_mode(port, "lowspeed_9v", "raw")
        time.sleep(0.1)

    def ultrasonic_cm(self, port, timeout: float = 0.5) -> Optional[int]:
        """Distance in cm from a LEGO ultrasonic sensor (None = nothing in range)."""
        self.ls_write(port, b"\x02\x42", 1)
        deadline = time.monotonic() + timeout
        while True:
            try:
                n = self.ls_status(port)
            except P.NxtError as e:
                if e.status == 0x20:
                    n = -1
                else:
                    raise
            if n >= 1:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError("ultrasonic sensor did not answer; is it on that port?")
            time.sleep(0.01)
        d = self.ls_read(port)
        if not d:
            return None
        return None if d[0] == 255 else d[0]

    # ------------------------------------------------------------- messages
    def message_write(self, inbox: int, text: Union[str, bytes]) -> None:
        b = text.encode("ascii", "replace") if isinstance(text, str) else bytes(text)
        b = b[:58] + b"\x00"
        self.direct(P.MESSAGE_WRITE, bytes([inbox & 0x0F, len(b)]) + b)

    def message_read(self, inbox: int, remove: bool = True) -> Optional[str]:
        """Read from mailbox ``inbox`` (0..9); None when empty."""
        status, d = self.call(P.DIRECT, P.MESSAGE_READ,
                              bytes([(inbox & 0x0F) + 10, inbox & 0x0F, 1 if remove else 0]),
                              ok_statuses=(0, 0x40))
        if status == 0x40:
            return None
        size = d[1]
        return P.cstr(d[2:2 + size])

    # ------------------------------------------------------------- programs
    def start_program(self, name: str) -> None:
        self.direct(P.START_PROGRAM, P.name20(name))

    def stop_program(self) -> None:
        self.call(P.DIRECT, P.STOP_PROGRAM, ok_statuses=(0, 0xEC))

    def current_program(self) -> Optional[str]:
        status, d = self.call(P.DIRECT, P.GET_CURRENT_PROGRAM_NAME, ok_statuses=(0, 0xEC))
        return None if status else P.cstr(d[:20])

    # ------------------------------------------------------------- files
    def list_files(self, pattern: str = "*.*") -> List[Tuple[str, int]]:
        out = []
        try:
            d = self.system(P.FIND_FIRST, P.name20(pattern))
        except P.NxtError as e:
            if e.status in (0x87, 0x83):
                return out
            raise
        handle = d[0]
        out.append((P.cstr(d[1:21]), struct.unpack("<I", d[21:25])[0]))
        try:
            while True:
                d = self.system(P.FIND_NEXT, bytes([handle]))
                handle = d[0]
                out.append((P.cstr(d[1:21]), struct.unpack("<I", d[21:25])[0]))
        except P.NxtError as e:
            if e.status not in (0x83, 0x87):
                raise
        finally:
            try:
                self.system(P.CLOSE, bytes([handle]))
            except P.NxtError:
                pass
        return out

    def delete_file(self, name: str) -> None:
        self.system(P.DELETE, P.name20(name))

    def upload(self, name: str, data: bytes, progress: Progress = None, replace: bool = True) -> None:
        """Write ``data`` to the brick as ``name`` (program, sound, picture or data)."""
        if replace:
            try:
                self.delete_file(name)
            except P.NxtError as e:
                if e.status not in (0x87, 0xBD):
                    raise
        op = P.OPEN_WRITE_LINEAR if P.is_linear_file(name) else P.OPEN_WRITE
        handle = self.system(op, P.name20(name) + struct.pack("<I", len(data)))[0]
        try:
            pos = 0
            while pos < len(data):
                chunk = data[pos:pos + P.WRITE_CHUNK]
                d = self.system(P.WRITE, bytes([handle]) + chunk)
                written = struct.unpack("<H", d[1:3])[0]
                if written != len(chunk):
                    raise P.NxtError(P.WRITE, 0x8E)
                pos += len(chunk)
                if progress:
                    progress(pos, len(data))
        finally:
            self.system(P.CLOSE, bytes([handle]))

    def upload_file(self, path: Union[str, Path], name: Optional[str] = None, progress: Progress = None) -> str:
        path = Path(path)
        name = name or path.name
        self.upload(name, path.read_bytes(), progress)
        return name

    def download(self, name: str, progress: Progress = None) -> bytes:
        d = self.system(P.OPEN_READ, P.name20(name))
        handle, size = d[0], struct.unpack("<I", d[1:5])[0]
        out = bytearray()
        try:
            while len(out) < size:
                n = min(P.WRITE_CHUNK, size - len(out))
                d = self.system(P.READ, bytes([handle]) + struct.pack("<H", n))
                got = struct.unpack("<H", d[1:3])[0]
                out += d[3:3 + got]
                if got == 0:
                    break
                if progress:
                    progress(len(out), size)
        finally:
            try:
                self.system(P.CLOSE, bytes([handle]))
            except P.NxtError:
                pass
        return bytes(out)

    def delete_user_flash(self) -> None:
        self.system(P.DELETE_USER_FLASH, timeout=10.0)

    def boot_firmware_mode(self) -> None:
        """Reboot into SAM-BA firmware-update mode (USB only; the brick then ticks)."""
        self.system(P.BOOT, P.BOOT_MAGIC)
