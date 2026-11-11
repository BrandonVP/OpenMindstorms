"""LEGO Mindstorms NXT communication protocol: message framing and constants.

Every message is ``[type, command, payload...]``.  Types:

* 0x00 direct command, reply wanted     0x80 direct command, no reply
* 0x01 system command, reply wanted     0x81 system command, no reply
* 0x02 reply: ``[0x02, command, status, payload...]``

Over USB a message is one bulk transfer (max 64 bytes).  Over Bluetooth every
message is preceded by its length as a little-endian 16-bit word.
Source: LEGO "NXT Communication Protocol" and "Direct Commands" (Bluetooth
Developer Kit), reconciled with nxt-python.
"""

from __future__ import annotations

import struct
from typing import Optional, Tuple

DIRECT = 0x00
DIRECT_NOREPLY = 0x80
SYSTEM = 0x01
SYSTEM_NOREPLY = 0x81
REPLY = 0x02

# --------------------------------------------------------------- direct commands
START_PROGRAM = 0x00
STOP_PROGRAM = 0x01
PLAY_SOUND_FILE = 0x02
PLAY_TONE = 0x03
SET_OUTPUT_STATE = 0x04
SET_INPUT_MODE = 0x05
GET_OUTPUT_STATE = 0x06
GET_INPUT_VALUES = 0x07
RESET_INPUT_SCALED_VALUE = 0x08
MESSAGE_WRITE = 0x09
RESET_MOTOR_POSITION = 0x0A
GET_BATTERY_LEVEL = 0x0B
STOP_SOUND_PLAYBACK = 0x0C
KEEP_ALIVE = 0x0D
LS_GET_STATUS = 0x0E
LS_WRITE = 0x0F
LS_READ = 0x10
GET_CURRENT_PROGRAM_NAME = 0x11
MESSAGE_READ = 0x13

# --------------------------------------------------------------- system commands
OPEN_READ = 0x80
OPEN_WRITE = 0x81
READ = 0x82
WRITE = 0x83
CLOSE = 0x84
DELETE = 0x85
FIND_FIRST = 0x86
FIND_NEXT = 0x87
GET_FIRMWARE_VERSION = 0x88
OPEN_WRITE_LINEAR = 0x89
OPEN_READ_LINEAR = 0x8A
OPEN_WRITE_DATA = 0x8B
OPEN_APPEND_DATA = 0x8C
BOOT = 0x97
SET_BRICK_NAME = 0x98
GET_DEVICE_INFO = 0x9B
DELETE_USER_FLASH = 0xA0
POLL_COMMAND_LENGTH = 0xA1
POLL_COMMAND = 0xA2
BLUETOOTH_FACTORY_RESET = 0xA4

COMMAND_NAMES = {
    START_PROGRAM: "StartProgram", STOP_PROGRAM: "StopProgram", PLAY_SOUND_FILE: "PlaySoundFile",
    PLAY_TONE: "PlayTone", SET_OUTPUT_STATE: "SetOutputState", SET_INPUT_MODE: "SetInputMode",
    GET_OUTPUT_STATE: "GetOutputState", GET_INPUT_VALUES: "GetInputValues",
    RESET_INPUT_SCALED_VALUE: "ResetInputScaledValue", MESSAGE_WRITE: "MessageWrite",
    RESET_MOTOR_POSITION: "ResetMotorPosition", GET_BATTERY_LEVEL: "GetBatteryLevel",
    STOP_SOUND_PLAYBACK: "StopSoundPlayback", KEEP_ALIVE: "KeepAlive", LS_GET_STATUS: "LSGetStatus",
    LS_WRITE: "LSWrite", LS_READ: "LSRead", GET_CURRENT_PROGRAM_NAME: "GetCurrentProgramName",
    MESSAGE_READ: "MessageRead", OPEN_READ: "OpenRead", OPEN_WRITE: "OpenWrite", READ: "Read",
    WRITE: "Write", CLOSE: "Close", DELETE: "Delete", FIND_FIRST: "FindFirst", FIND_NEXT: "FindNext",
    GET_FIRMWARE_VERSION: "GetFirmwareVersion", OPEN_WRITE_LINEAR: "OpenWriteLinear",
    OPEN_READ_LINEAR: "OpenReadLinear", OPEN_WRITE_DATA: "OpenWriteData",
    OPEN_APPEND_DATA: "OpenAppendData", BOOT: "Boot", SET_BRICK_NAME: "SetBrickName",
    GET_DEVICE_INFO: "GetDeviceInfo", DELETE_USER_FLASH: "DeleteUserFlash",
    POLL_COMMAND_LENGTH: "PollCommandLength", POLL_COMMAND: "PollCommand",
    BLUETOOTH_FACTORY_RESET: "BluetoothFactoryReset",
}

STATUS = {
    0x00: "success",
    0x20: "pending communication transaction in progress",
    0x40: "specified mailbox queue is empty",
    0x81: "no more handles",
    0x82: "no space",
    0x83: "no more files",
    0x84: "end of file expected",
    0x85: "end of file",
    0x86: "not a linear file",
    0x87: "file not found",
    0x88: "handle already closed",
    0x89: "no linear space",
    0x8A: "undefined error",
    0x8B: "file is busy",
    0x8C: "no write buffers",
    0x8D: "append not possible",
    0x8E: "file is full",
    0x8F: "file exists",
    0x90: "module not found",
    0x91: "out of boundary",
    0x92: "illegal file name",
    0x93: "illegal handle",
    0xBD: "request failed (file not found or no running program)",
    0xBE: "unknown command opcode",
    0xBF: "insane packet",
    0xC0: "data contains out-of-range values",
    0xDD: "communication bus error",
    0xDE: "no free memory in communication buffer",
    0xDF: "specified channel/connection is not valid",
    0xE0: "specified channel/connection not configured or busy",
    0xEC: "no active program",
    0xED: "illegal size specified",
    0xEE: "illegal mailbox queue ID specified",
    0xEF: "attempted to access invalid field of a structure",
    0xF0: "bad input or output specified",
    0xFB: "insufficient memory available",
    0xFF: "bad arguments",
}

# --------------------------------------------------------------- sensors
SENSOR_TYPES = {
    "none": 0x00, "touch": 0x01, "temperature": 0x02, "reflection": 0x03, "angle": 0x04,
    "light": 0x05, "light_passive": 0x06, "sound": 0x07, "sound_dba": 0x08, "custom": 0x09,
    "lowspeed": 0x0A, "lowspeed_9v": 0x0B, "color": 0x0D, "color_red": 0x0E,
    "color_green": 0x0F, "color_blue": 0x10, "color_none": 0x11,
}
SENSOR_TYPE_NAMES = {v: k for k, v in SENSOR_TYPES.items()}
SENSOR_MODES = {
    "raw": 0x00, "bool": 0x20, "edge": 0x40, "pulse": 0x60, "percent": 0x80,
    "celsius": 0xA0, "fahrenheit": 0xC0, "angle": 0xE0,
}
SENSOR_MODE_NAMES = {v: k for k, v in SENSOR_MODES.items()}
# a sensible mode for each type, as NXT-G configures them
DEFAULT_MODE = {
    "touch": "bool", "light": "percent", "light_passive": "percent", "sound": "percent",
    "sound_dba": "percent", "ultrasonic": "raw", "lowspeed_9v": "raw", "lowspeed": "raw",
    "color": "raw", "angle": "angle", "temperature": "celsius", "none": "raw",
}
COLOR_NAMES = {1: "black", 2: "blue", 3: "green", 4: "yellow", 5: "red", 6: "white"}

# --------------------------------------------------------------- motors
MOTOR_ON = 0x01
MOTOR_BRAKE = 0x02
MOTOR_REGULATED = 0x04
REGULATION_IDLE = 0x00
REGULATION_SPEED = 0x01
REGULATION_SYNC = 0x02
RUN_IDLE = 0x00
RUN_RAMPUP = 0x10
RUN_RUNNING = 0x20
RUN_RAMPDOWN = 0x40
PORT_ALL = 0xFF
MOTOR_PORTS = {"A": 0, "B": 1, "C": 2}

# --------------------------------------------------------------- USB
USB_VID = 0x0694
USB_PID = 0x0002
USB_EP_OUT = 0x01
USB_EP_IN = 0x82
USB_PACKET = 64
# Write command = type + command + handle + data, and the whole thing must fit
# one USB packet.  Keep some slack like the LEGO tools do.
WRITE_CHUNK = 58

BOOT_MAGIC = b"Let's dance: SAMBA\x00"


class NxtError(Exception):
    def __init__(self, command: int, status: int):
        self.command, self.status = command, status
        super().__init__(f"{COMMAND_NAMES.get(command, hex(command))} failed: "
                         f"{STATUS.get(status, 'unknown status 0x%02x' % status)} (0x{status:02X})")


def name20(name: str) -> bytes:
    """A file name as the brick wants it: 15.3 characters max, NUL padded to 20."""
    b = name.encode("ascii", "replace")
    if len(b) > 19:
        raise ValueError(f"file name '{name}' is longer than 19 characters")
    return b + b"\x00" * (20 - len(b))


def cstr(data: bytes) -> str:
    return data.split(b"\x00", 1)[0].decode("ascii", "replace")


def build(msg_type: int, command: int, payload: bytes = b"") -> bytes:
    return bytes([msg_type, command]) + payload


def parse_reply(data: bytes) -> Tuple[int, int, bytes]:
    """Return (command, status, payload) from a reply message."""
    if len(data) < 3 or data[0] != REPLY:
        raise ValueError(f"not an NXT reply: {data.hex()}")
    return data[1], data[2], bytes(data[3:])


def command_name(command: int) -> str:
    return COMMAND_NAMES.get(command, f"0x{command:02X}")


def bt_frame(msg: bytes) -> bytes:
    return struct.pack("<H", len(msg)) + msg


def hexs(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data)


def is_linear_file(name: str) -> bool:
    """Executables and sounds/pictures must be stored contiguously."""
    return name.lower().endswith((".rxe", ".rso", ".ric", ".rpg", ".rtm", ".sys"))


def sensor_type_code(t) -> int:
    if isinstance(t, int):
        return t
    t = t.lower()
    if t == "ultrasonic":
        return SENSOR_TYPES["lowspeed_9v"]
    return SENSOR_TYPES[t]


def sensor_mode_code(m) -> int:
    return m if isinstance(m, int) else SENSOR_MODES[m.lower()]


def motor_port(p) -> int:
    if isinstance(p, int):
        return p
    p = p.upper()
    if p in ("ALL", "*"):
        return PORT_ALL
    return MOTOR_PORTS[p]


def sensor_port(p) -> int:
    """Sensor ports are 1..4 to humans, 0..3 to the brick."""
    if isinstance(p, str):
        p = int(p)
    if 1 <= p <= 4:
        return p - 1
    raise ValueError("sensor port must be 1..4")


def optional(v: Optional[int], default: int) -> int:
    return default if v is None else v
