"""RCX infrared protocol: opcodes, packet framing and reply parsing.

Wire format (2400 baud, 8 data bits, odd parity, 1 stop bit, 38 kHz carrier):

    55 FF 00  D1 ~D1  D2 ~D2 ... Dn ~Dn  C ~C

D1 is the opcode, D2..Dn its arguments, C = (D1 + ... + Dn) mod 256.
Every byte is followed by its bitwise complement.  The RCX answers with the
complemented opcode (~D1) followed by the reply payload in the same framing.

The RCX ignores a command whose opcode is byte-identical to the previous one,
so consecutive commands flip bit 3 (0x08) of the opcode.  Reply opcodes are
compared with that bit masked off.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

HEADER = b"\x55\xff\x00"
TOGGLE = 0x08

# ---------------------------------------------------------------------------
# Opcodes (base form; the 0x08 bit may be toggled on the wire)
# ---------------------------------------------------------------------------
ALIVE = 0x10
GET_VALUE = 0x12
SET_MOTOR_POWER = 0x13
SET_VARIABLE = 0x14
GET_VERSIONS = 0x15
CALL_SUB = 0x17
GET_MEMORY_MAP = 0x20
SET_MOTOR_ON_OFF = 0x21
SET_TIME = 0x22
PLAY_TONE = 0x23
BEGIN_TASK = 0x25
GET_BATTERY = 0x30
SET_TX_RANGE = 0x31
SET_SENSOR_TYPE = 0x32
SET_DISPLAY = 0x33
BEGIN_SUB = 0x35
DELETE_ALL_TASKS = 0x40
SET_SENSOR_MODE = 0x42
TRANSFER_DATA = 0x45
STOP_ALL_TASKS = 0x50
PLAY_SOUND = 0x51
SET_DATALOG_SIZE = 0x52
POWER_OFF = 0x60
DELETE_TASK = 0x61
DATALOG_NEXT = 0x62
DELETE_FIRMWARE = 0x65
DELETE_ALL_SUBS = 0x70
START_TASK = 0x71
BEGIN_FIRMWARE = 0x75
STOP_TASK = 0x81
SET_PROGRAM = 0x91
CLEAR_TIMER = 0xA1
UPLOAD_DATALOG = 0xA4
UNLOCK_FIRMWARE = 0xA5
SET_POWER_DOWN_DELAY = 0xB1
SEND_MESSAGE = 0xB2
DELETE_SUB = 0xC1
CLEAR_SENSOR = 0xD1
SET_MOTOR_DIR = 0xE1
SET_MESSAGE = 0xF7

OPCODE_NAMES = {
    ALIVE: "Alive", GET_VALUE: "GetValue", SET_MOTOR_POWER: "SetMotorPower",
    SET_VARIABLE: "SetVariable", GET_VERSIONS: "GetVersions",
    GET_MEMORY_MAP: "GetMemoryMap", SET_MOTOR_ON_OFF: "SetMotorOnOff",
    SET_TIME: "SetTime", PLAY_TONE: "PlayTone", BEGIN_TASK: "BeginTask",
    GET_BATTERY: "GetBattery", SET_TX_RANGE: "SetTxRange",
    SET_SENSOR_TYPE: "SetSensorType", SET_DISPLAY: "SetDisplay",
    BEGIN_SUB: "BeginSub", DELETE_ALL_TASKS: "DeleteAllTasks",
    SET_SENSOR_MODE: "SetSensorMode", TRANSFER_DATA: "TransferData",
    STOP_ALL_TASKS: "StopAllTasks", PLAY_SOUND: "PlaySound",
    SET_DATALOG_SIZE: "SetDatalogSize", POWER_OFF: "PowerOff",
    DELETE_TASK: "DeleteTask", DATALOG_NEXT: "DatalogNext",
    DELETE_FIRMWARE: "DeleteFirmware", DELETE_ALL_SUBS: "DeleteAllSubs",
    START_TASK: "StartTask", BEGIN_FIRMWARE: "BeginFirmware",
    STOP_TASK: "StopTask", SET_PROGRAM: "SetProgram", CLEAR_TIMER: "ClearTimer",
    UPLOAD_DATALOG: "UploadDatalog", UNLOCK_FIRMWARE: "UnlockFirmware",
    SET_POWER_DOWN_DELAY: "SetPowerDownDelay", SEND_MESSAGE: "SendMessage",
    DELETE_SUB: "DeleteSub", CLEAR_SENSOR: "ClearSensor",
    SET_MOTOR_DIR: "SetMotorDir", SET_MESSAGE: "SetMessage",
}

# Commands the RCX never answers.
NO_REPLY = {SET_MESSAGE, SEND_MESSAGE}

# Magic keys
VERSIONS_KEY = bytes([1, 3, 5, 7, 0x0B])
DELETE_FIRMWARE_KEY = bytes([1, 3, 5, 7, 0x0B])
UNLOCK_KEY = b"LEGO\xae"
UNLOCK_REPLY = b"Just a bit off the block!"

# Get-value sources
SRC_VARIABLE = 0
SRC_TIMER = 1
SRC_CONSTANT = 2
SRC_MOTOR_STATUS = 3
SRC_RANDOM = 4
SRC_PROGRAM = 8
SRC_SENSOR_VALUE = 9
SRC_SENSOR_TYPE = 10
SRC_SENSOR_MODE = 11
SRC_SENSOR_RAW = 12
SRC_SENSOR_BOOL = 13
SRC_WATCH = 14
SRC_MESSAGE = 15

SOURCES = {
    "var": SRC_VARIABLE, "timer": SRC_TIMER, "motor": SRC_MOTOR_STATUS,
    "program": SRC_PROGRAM, "sensor": SRC_SENSOR_VALUE,
    "type": SRC_SENSOR_TYPE, "mode": SRC_SENSOR_MODE, "raw": SRC_SENSOR_RAW,
    "bool": SRC_SENSOR_BOOL, "watch": SRC_WATCH, "message": SRC_MESSAGE,
}

# Sensor types / modes (match NQC's SENSOR_TYPE_* / SENSOR_MODE_*)
SENSOR_TYPES = {"none": 0, "touch": 1, "temp": 2, "temperature": 2,
                "light": 3, "rotation": 4}
SENSOR_MODES = {"raw": 0, "bool": 1, "edge": 2, "pulse": 3, "percent": 4,
                "celsius": 5, "fahrenheit": 6, "rotation": 7}

MOTOR_BITS = {"A": 0x01, "B": 0x02, "C": 0x04}

SOUNDS = {"click": 0, "beep": 1, "down": 2, "up": 3, "error": 4, "fastup": 5}


def opcode_name(op: int) -> str:
    return OPCODE_NAMES.get(op & 0xF7, f"0x{op & 0xF7:02X}")


def checksum8(data: bytes) -> int:
    return sum(data) & 0xFF


def build_packet(body: bytes, header: bytes = HEADER) -> bytes:
    """Frame a command body (opcode + args) for the wire."""
    if not body:
        raise ValueError("empty command body")
    out = bytearray(header)
    for b in body:
        out.append(b)
        out.append(b ^ 0xFF)
    c = checksum8(body)
    out.append(c)
    out.append(c ^ 0xFF)
    return bytes(out)


def expected_reply_length(body: bytes) -> Optional[int]:
    """Payload byte count the RCX returns for a command (None = unknown)."""
    op = body[0] & 0xF7
    if op in NO_REPLY:
        return 0
    if op in (BEGIN_TASK, BEGIN_SUB, TRANSFER_DATA, BEGIN_FIRMWARE,
              SET_DATALOG_SIZE, DATALOG_NEXT):
        return 1
    if op in (GET_BATTERY, GET_VALUE):
        return 2
    if op == GET_VERSIONS:
        return 8
    if op == UNLOCK_FIRMWARE:
        return 25
    if op == GET_MEMORY_MAP:
        return 188
    if op == UPLOAD_DATALOG:
        if len(body) != 5:
            return None
        count = body[3] | (body[4] << 8)
        return count * 3
    return 0


@dataclass
class Reply:
    opcode: int          # reply opcode as received (complement of the command)
    payload: bytes       # data bytes, complements stripped
    start: int           # offset in the receive buffer where the sync began
    end: int             # offset just past the checksum complement


def find_reply(buf: bytes, cmd_opcode: int, expected: Optional[int] = None,
               offset: int = 0) -> Optional[Reply]:
    """Locate a complete, valid reply to ``cmd_opcode`` inside ``buf``.

    Tolerates a missing leading 0x55 (USB tower) or 0x55 0xFF (noisy start),
    echo of our own transmission, and stray bytes.  Returns None if no valid
    reply has been received yet.
    """
    want = (~cmd_opcode) & 0xF7
    n = len(buf)
    i = offset
    while i < n:
        # Find a sync pattern followed by the complemented opcode.
        if buf[i] == 0x55 and i + 2 < n and buf[i + 1] == 0xFF and buf[i + 2] == 0x00:
            data_at = i + 3
        elif buf[i] == 0xFF and i + 1 < n and buf[i + 1] == 0x00:
            data_at = i + 2
        elif buf[i] == 0x00:
            data_at = i + 1
        else:
            i += 1
            continue
        if data_at >= n or (buf[data_at] & 0xF7) != want:
            i += 1
            continue
        r = _verify(buf, i, data_at, expected)
        if r is not None:
            return r
        i += 1
    return None


def _verify(buf: bytes, start: int, p: int, expected: Optional[int]) -> Optional[Reply]:
    n = len(buf)
    # opcode + complement
    if p + 1 >= n or buf[p] ^ buf[p + 1] != 0xFF:
        return None
    opcode = buf[p]
    payload = bytearray()
    csum = opcode
    q = p + 2
    if expected is not None:
        need = q + 2 * expected + 2
        if need > n:
            return None
        for _ in range(expected):
            if buf[q] ^ buf[q + 1] != 0xFF:
                return None
            payload.append(buf[q])
            csum = (csum + buf[q]) & 0xFF
            q += 2
        if buf[q] != csum or buf[q + 1] != (csum ^ 0xFF):
            return None
        return Reply(opcode, bytes(payload), start, q + 2)
    # Unknown length: scan forward for a byte pair that matches the running
    # checksum (the same heuristic NQC uses).
    while q + 1 < n:
        if buf[q] ^ buf[q + 1] != 0xFF:
            return None
        if buf[q] == csum:
            return Reply(opcode, bytes(payload), start, q + 2)
        payload.append(buf[q])
        csum = (csum + buf[q]) & 0xFF
        q += 2
    return None


def parse_command(packet: bytes) -> Optional[bytes]:
    """Decode one complete PC->RCX packet (used by the simulator).

    Returns the command body (opcode + args) or None if the packet is
    malformed: bad sync, broken complement pair or checksum mismatch.
    """
    n = len(packet)
    if n >= 3 and packet[:3] == b"\x55\xff\x00":
        p = 3
    elif n >= 2 and packet[:2] == b"\xff\x00":
        p = 2
    else:
        return None
    rest = packet[p:]
    if len(rest) < 4 or len(rest) % 2:
        return None
    pairs = [rest[i:i + 2] for i in range(0, len(rest), 2)]
    for a, b in pairs:
        if a ^ b != 0xFF:
            return None
    body = bytes(a for a, _ in pairs[:-1])
    if pairs[-1][0] != checksum8(body):
        return None
    return body


def hexs(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data)
