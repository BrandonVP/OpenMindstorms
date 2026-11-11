"""LEGO Mindstorms EV3 protocol: message framing, bytecode parameter encoding,
opcodes and subcodes (lms2012), system commands, and the .rbf image format.

Direct command (type 0x00 reply / 0x80 no reply):
    [u16 length][u16 counter][type][u16 header: globals (10 bits) | locals << 10][bytecodes]
Direct reply:  [u16 length][u16 counter][0x02 ok | 0x04 error][global bytes]
System command (0x01 / 0x81): [len][counter][type][command][payload]
System reply:  [len][counter][0x03 ok | 0x05 error][command][status][payload]

Source: LEGO "EV3 Communication Developer Kit" and "EV3 Firmware Developer Kit",
lms2012 bytecodes.h.  Verified against a real brick (firmware V1.09H).
"""

from __future__ import annotations

import struct
from typing import Dict, List, Optional, Tuple

# --------------------------------------------------------------- message types
DIRECT_REPLY = 0x00
DIRECT_NO_REPLY = 0x80
SYSTEM_REPLY = 0x01
SYSTEM_NO_REPLY = 0x81
REPLY_DIRECT = 0x02
REPLY_DIRECT_ERROR = 0x04
REPLY_SYSTEM = 0x03
REPLY_SYSTEM_ERROR = 0x05

USB_VID = 0x0694
USB_PID = 0x0005
HID_REPORT = 1024
MAX_MESSAGE = 1024        # whole message incl. length word, over USB

# --------------------------------------------------------------- system commands
BEGIN_DOWNLOAD = 0x92
CONTINUE_DOWNLOAD = 0x93
BEGIN_UPLOAD = 0x94
CONTINUE_UPLOAD = 0x95
BEGIN_GETFILE = 0x96
CONTINUE_GETFILE = 0x97
CLOSE_FILEHANDLE = 0x98
LIST_FILES = 0x99
CONTINUE_LIST_FILES = 0x9A
CREATE_DIR = 0x9B
DELETE_FILE = 0x9C
LIST_OPEN_HANDLES = 0x9D
WRITEMAILBOX = 0x9E
BLUETOOTHPIN = 0x9F
ENTERFWUPDATE = 0xA0

SYSTEM_STATUS = {
    0: "success", 1: "unknown handle", 2: "handle not ready", 3: "corrupt file",
    4: "no handles available", 5: "no permission", 6: "illegal path", 7: "file exists",
    8: "end of file", 9: "size error", 10: "unknown error", 11: "illegal filename",
    12: "illegal connection",
}

# --------------------------------------------------------------- opcodes (subset we use)
OP = dict(
    ERROR=0x00, NOP=0x01, PROGRAM_STOP=0x02, PROGRAM_START=0x03, OBJECT_STOP=0x04,
    OBJECT_START=0x05, OBJECT_TRIG=0x06, OBJECT_WAIT=0x07, RETURN=0x08, CALL=0x09,
    OBJECT_END=0x0A, SLEEP=0x0B, PROGRAM_INFO=0x0C, LABEL=0x0D, PROBE=0x0E, DO=0x0F,
    ADD8=0x10, ADD16=0x11, ADD32=0x12, ADDF=0x13, SUB8=0x14, SUB16=0x15, SUB32=0x16, SUBF=0x17,
    MUL8=0x18, MUL16=0x19, MUL32=0x1A, MULF=0x1B, DIV8=0x1C, DIV16=0x1D, DIV32=0x1E, DIVF=0x1F,
    OR8=0x20, OR16=0x21, OR32=0x22, AND8=0x24, AND16=0x25, AND32=0x26, XOR8=0x28, XOR16=0x29, XOR32=0x2A,
    RL8=0x2C, RL16=0x2D, RL32=0x2E, INIT_BYTES=0x2F,
    MOVE8_8=0x30, MOVE8_16=0x31, MOVE8_32=0x32, MOVE8_F=0x33, MOVE16_8=0x34, MOVE16_16=0x35,
    MOVE16_32=0x36, MOVE16_F=0x37, MOVE32_8=0x38, MOVE32_16=0x39, MOVE32_32=0x3A, MOVE32_F=0x3B,
    MOVEF_8=0x3C, MOVEF_16=0x3D, MOVEF_32=0x3E, MOVEF_F=0x3F,
    JR=0x40, JR_FALSE=0x41, JR_TRUE=0x42, JR_NAN=0x43,
    CP_LT8=0x44, CP_LT16=0x45, CP_LT32=0x46, CP_LTF=0x47, CP_GT8=0x48, CP_GT16=0x49, CP_GT32=0x4A, CP_GTF=0x4B,
    CP_EQ8=0x4C, CP_EQ16=0x4D, CP_EQ32=0x4E, CP_EQF=0x4F, CP_NEQ8=0x50, CP_NEQ16=0x51, CP_NEQ32=0x52, CP_NEQF=0x53,
    CP_LTEQ8=0x54, CP_LTEQ16=0x55, CP_LTEQ32=0x56, CP_LTEQF=0x57, CP_GTEQ8=0x58, CP_GTEQ16=0x59, CP_GTEQ32=0x5A, CP_GTEQF=0x5B,
    SELECT8=0x5C, SELECT16=0x5D, SELECT32=0x5E, SELECTF=0x5F,
    SYSTEM=0x60, PORT_CNV_OUTPUT=0x61, PORT_CNV_INPUT=0x62, NOTE_TO_FREQ=0x63,
    JR_LT8=0x64, JR_LT16=0x65, JR_LT32=0x66, JR_LTF=0x67, JR_GT8=0x68, JR_GT16=0x69, JR_GT32=0x6A, JR_GTF=0x6B,
    JR_EQ8=0x6C, JR_EQ16=0x6D, JR_EQ32=0x6E, JR_EQF=0x6F, JR_NEQ8=0x70, JR_NEQ16=0x71, JR_NEQ32=0x72, JR_NEQF=0x73,
    JR_LTEQ8=0x74, JR_LTEQ16=0x75, JR_LTEQ32=0x76, JR_LTEQF=0x77, JR_GTEQ8=0x78, JR_GTEQ16=0x79, JR_GTEQ32=0x7A, JR_GTEQF=0x7B,
    INFO=0x7C, STRINGS=0x7D, MEMORY_WRITE=0x7E, MEMORY_READ=0x7F,
    UI_FLUSH=0x80, UI_READ=0x81, UI_WRITE=0x82, UI_BUTTON=0x83, UI_DRAW=0x84,
    TIMER_WAIT=0x85, TIMER_READY=0x86, TIMER_READ=0x87, MATH=0x8D, RANDOM=0x8E, TIMER_READ_US=0x8F,
    KEEP_ALIVE=0x90, COM_READ=0x91, COM_WRITE=0x92, SOUND=0x94, SOUND_TEST=0x95, SOUND_READY=0x96,
    INPUT_SAMPLE=0x97, INPUT_DEVICE_LIST=0x98, INPUT_DEVICE=0x99, INPUT_READ=0x9A, INPUT_TEST=0x9B,
    INPUT_READY=0x9C, INPUT_READSI=0x9D, INPUT_READEXT=0x9E, INPUT_WRITE=0x9F,
    OUTPUT_GET_TYPE=0xA0, OUTPUT_SET_TYPE=0xA1, OUTPUT_RESET=0xA2, OUTPUT_STOP=0xA3, OUTPUT_POWER=0xA4,
    OUTPUT_SPEED=0xA5, OUTPUT_START=0xA6, OUTPUT_POLARITY=0xA7, OUTPUT_READ=0xA8, OUTPUT_TEST=0xA9,
    OUTPUT_READY=0xAA, OUTPUT_POSITION=0xAB, OUTPUT_STEP_POWER=0xAC, OUTPUT_TIME_POWER=0xAD,
    OUTPUT_STEP_SPEED=0xAE, OUTPUT_TIME_SPEED=0xAF, OUTPUT_STEP_SYNC=0xB0, OUTPUT_TIME_SYNC=0xB1,
    OUTPUT_CLR_COUNT=0xB2, OUTPUT_GET_COUNT=0xB3, OUTPUT_PRG_STOP=0xB4,
    FILE=0xC0, ARRAY=0xC1, ARRAY_WRITE=0xC2, ARRAY_READ=0xC3, ARRAY_APPEND=0xC4, MEMORY_USAGE=0xC5,
    FILENAME=0xC6, READ8=0xC8, READ16=0xC9, READ32=0xCA, READF=0xCB, WRITE8=0xCC, WRITE16=0xCD,
    WRITE32=0xCE, WRITEF=0xCF, COM_READY=0xD0, COM_READDATA=0xD1, COM_WRITEDATA=0xD2, COM_GET=0xD3,
    COM_SET=0xD4, COM_TEST=0xD5, COM_REMOVE=0xD6, COM_WRITEFILE=0xD7, MAILBOX_OPEN=0xD8,
    MAILBOX_WRITE=0xD9, MAILBOX_READ=0xDA, MAILBOX_TEST=0xDB, MAILBOX_READY=0xDC, MAILBOX_CLOSE=0xDD,
    TST=0xFF,
)
OP_NAMES = {v: k for k, v in OP.items()}

# subcodes
UI_READ = dict(GET_VBATT=0x01, GET_IBATT=0x02, GET_OS_VERS=0x03, GET_EVENT=0x04, GET_TBATT=0x05,
               GET_IINT=0x06, GET_IMOTOR=0x07, GET_STRING=0x08, GET_HW_VERS=0x09, GET_FW_VERS=0x0A,
               GET_FW_BUILD=0x0B, GET_OS_BUILD=0x0C, GET_ADDRESS=0x0D, GET_CODE=0x0E, KEY=0x0F,
               GET_SHUTDOWN=0x10, GET_WARNING=0x11, GET_LBATT=0x12, TEXTBOX_READ=0x15, GET_VERSION=0x1A,
               GET_IP=0x1B, GET_POWER=0x1D, GET_SDCARD=0x1E, GET_USBSTICK=0x1F)
UI_WRITE = dict(WRITE_FLUSH=0x01, FLOATVALUE=0x02, STAMP=0x03, PUT_STRING=0x08, VALUE8=0x09, VALUE16=0x0A,
                VALUE32=0x0B, VALUEF=0x0C, ADDRESS=0x0D, CODE=0x0E, DOWNLOAD_END=0x0F, SCREEN_BLOCK=0x10,
                TEXTBOX_APPEND=0x15, SET_BUSY=0x16, SET_TESTPIN=0x17, INIT_RUN=0x18, UPDATE_RUN=0x1A,
                LED=0x1B, POWER=0x1D, GRAPH_SAMPLE=0x1E, TERMINAL=0x1F)
UI_DRAW = dict(UPDATE=0x00, CLEAN=0x01, PIXEL=0x02, LINE=0x03, CIRCLE=0x04, TEXT=0x05, ICON=0x06, PICTURE=0x07,
               VALUE=0x08, FILLRECT=0x09, RECT=0x0A, NOTIFICATION=0x0B, QUESTION=0x0C, KEYBOARD=0x0D,
               BROWSE=0x0E, VERTBAR=0x0F, INVERSERECT=0x10, SELECT_FONT=0x11, TOPLINE=0x12, FILLWINDOW=0x13,
               SCROLL=0x14, DOTLINE=0x15, VIEW_VALUE=0x16, VIEW_UNIT=0x17, FILLCIRCLE=0x18, STORE=0x19,
               RESTORE=0x1A, ICON_QUESTION=0x1B, BMPFILE=0x1C, POPUP=0x1D, GRAPH_SETUP=0x1E, GRAPH_DRAW=0x1F, TEXTBOX=0x20)
UI_BUTTON = dict(SHORTPRESS=0x01, LONGPRESS=0x02, WAIT_FOR_PRESS=0x03, FLUSH=0x04, PRESS=0x05, RELEASE=0x06,
                 GET_HORZ=0x07, GET_VERT=0x08, PRESSED=0x09, SET_BACK_BLOCK=0x0A, GET_BACK_BLOCK=0x0B,
                 TESTSHORTPRESS=0x0C, TESTLONGPRESS=0x0D, GET_BUMBED=0x0E, GET_CLICK=0x0F)
BUTTONS = dict(up=1, enter=2, down=3, right=4, left=5, back=6, any=7)
SOUND = dict(BREAK=0, TONE=1, PLAY=2, REPEAT=3, SERVICE=4)
INPUT_DEVICE = dict(GET_FORMAT=2, CAL_MINMAX=3, CAL_DEFAULT=4, GET_TYPEMODE=5, GET_SYMBOL=6, CAL_MIN=7,
                    CAL_MAX=8, SETUP=9, CLR_ALL=10, GET_RAW=11, GET_CONNECTION=12, STOP_ALL=13, GET_NAME=21,
                    GET_MODENAME=22, SET_RAW=23, GET_FIGURES=24, GET_CHANGES=25, CLR_CHANGES=26,
                    READY_PCT=27, READY_RAW=28, READY_SI=29, GET_MINMAX=30, GET_BUMPS=31)
COM_GET = dict(GET_ON_OFF=1, GET_VISIBLE=2, GET_RESULT=4, GET_PIN=5, SEARCH_ITEMS=8, SEARCH_ITEM=9,
               FAVOUR_ITEMS=10, FAVOUR_ITEM=11, GET_ID=12, GET_BRICKNAME=13, GET_NETWORK=14,
               GET_PRESENT=15, GET_ENCRYPT=16, CONNEC_ITEMS=17, CONNEC_ITEM=18, GET_INCOMING=19, GET_MODE2=20)
COM_SET = dict(SET_ON_OFF=1, SET_VISIBLE=2, SET_SEARCH=3, SET_PIN=5, SET_PASSKEY=6, SET_CONNECTION=7,
               SET_BRICKNAME=8, SET_MOVEUP=9, SET_MOVEDOWN=10, SET_ENCRYPT=11, SET_SSID=12, SET_MODE2=13)
INFO = dict(SET_ERROR=1, GET_ERROR=2, ERRORTEXT=3, GET_VOLUME=4, SET_VOLUME=5, GET_MINUTES=6, SET_MINUTES=7)
FILE = dict(OPEN_APPEND=0, OPEN_READ=1, OPEN_WRITE=2, READ_VALUE=3, WRITE_VALUE=4, READ_TEXT=5, WRITE_TEXT=6,
            CLOSE=7, LOAD_IMAGE=8, GET_HANDLE=9, MAKE_FOLDER=10, GET_POOL=11, SET_LOG_SYNC_TIME=12,
            GET_FOLDERS=13, GET_LOG_SYNC_TIME=14, GET_SUBFOLDER_NAME=15, WRITE_LOG=16, CLOSE_LOG=17,
            GET_IMAGE=18, GET_ITEM=19, GET_CACHE_FILES=20, PUT_CACHE_FILE=21, GET_CACHE_FILE=22,
            DEL_CACHE_FILE=23, DEL_SUBFOLDER=24, GET_LOG_NAME=25, OPEN_LOG=27, READ_BYTES=28,
            WRITE_BYTES=29, REMOVE=30, MOVE=31)
PROGRAM_INFO = dict(OBJ_STOP=0, OBJ_START=4, GET_STATUS=22, GET_SPEED=23, GET_PRGRESULT=24, SET_INSTR=25)
MATH = dict(EXP=1, MOD=2, FLOOR=3, CEIL=4, ROUND=5, ABS=6, NEGATE=7, SQRT=8, LOG=9, LN=10, SIN=11, COS=12,
            TAN=13, ASIN=14, ACOS=15, ATAN=16, MOD8=17, MOD16=18, MOD32=19, POW=20, TRUNC=21)

LED_PATTERNS = dict(off=0, green=1, red=2, orange=3, green_flash=4, red_flash=5, orange_flash=6,
                    green_pulse=7, red_pulse=8, orange_pulse=9)
USER_SLOT = 1
DEBUG_SLOT = 2

# --------------------------------------------------------------- devices
DEVICE_TYPES = {
    1: "nxt-touch", 2: "nxt-light", 3: "nxt-sound", 4: "nxt-color", 5: "nxt-ultrasonic", 6: "nxt-temperature",
    7: "large-motor", 8: "medium-motor", 16: "touch", 29: "color", 30: "ultrasonic", 32: "gyro",
    33: "infrared", 99: "energy-meter", 100: "nxt-iic", 121: "unknown", 125: "unknown", 126: "none", 127: "error",
}
# (type, mode) -> (mode name, unit, number of values)
SENSOR_MODES = {
    16: {0: ("touch", "", 1), 1: ("bump", "count", 1)},
    29: {0: ("reflect", "%", 1), 1: ("ambient", "%", 1), 2: ("color", "", 1), 3: ("ref-raw", "", 2), 4: ("rgb-raw", "", 3), 5: ("cal", "", 4)},
    30: {0: ("distance", "cm", 1), 1: ("distance", "in", 1), 2: ("listen", "", 1), 3: ("single-cm", "cm", 1), 4: ("single-in", "in", 1)},
    32: {0: ("angle", "°", 1), 1: ("rate", "°/s", 1), 2: ("fast", "", 1), 3: ("rate-angle", "", 2), 4: ("cal", "", 1)},
    33: {0: ("proximity", "%", 1), 1: ("seek", "", 8), 2: ("remote", "", 4)},
    1: {0: ("touch", "", 1), 1: ("bump", "count", 1)},
    2: {0: ("reflect", "%", 1), 1: ("ambient", "%", 1)},
    3: {0: ("db", "%", 1), 1: ("dba", "%", 1)},
    4: {0: ("reflect", "%", 1), 1: ("ambient", "%", 1), 2: ("color", "", 1)},
    5: {0: ("distance", "cm", 1), 1: ("distance", "in", 1)},
    6: {0: ("temperature", "°C", 1), 1: ("temperature", "°F", 1)},
    7: {0: ("degrees", "°", 1), 1: ("rotations", "rot", 1), 2: ("power", "%", 1)},
    8: {0: ("degrees", "°", 1), 1: ("rotations", "rot", 1), 2: ("power", "%", 1)},
}
COLOR_NAMES = {0: "none", 1: "black", 2: "blue", 3: "green", 4: "yellow", 5: "red", 6: "white", 7: "brown"}
OUTPUT_PORTS = {"A": 1, "B": 2, "C": 4, "D": 8}

# --------------------------------------------------------------- parameter encoding
def LC0(v: int) -> bytes:
    """Short constant, -32..31."""
    if not -32 <= v <= 31:
        raise ValueError("LC0 range")
    return bytes([v & 0x3F])


def LC1(v: int) -> bytes:
    return bytes([0x81, v & 0xFF])


def LC2(v: int) -> bytes:
    return bytes([0x82]) + struct.pack("<H", v & 0xFFFF)


def LC4(v: int) -> bytes:
    return bytes([0x83]) + struct.pack("<i", v)


def LCF(v: float) -> bytes:
    return bytes([0x83]) + struct.pack("<f", v)


def LCS(s: str) -> bytes:
    return bytes([0x84]) + s.encode("ascii", "replace") + b"\x00"


def LC(v: int) -> bytes:
    """Smallest constant encoding for an integer."""
    if -32 <= v <= 31:
        return LC0(v)
    if -128 <= v <= 127:
        return LC1(v)
    if -32768 <= v <= 32767:
        return LC2(v)
    return LC4(v)


def GV0(i: int) -> bytes:
    return bytes([0x60 | (i & 0x1F)])


def GV1(i: int) -> bytes:
    return bytes([0xE1, i & 0xFF])


def GV2(i: int) -> bytes:
    return bytes([0xE2]) + struct.pack("<H", i)


def GV(i: int) -> bytes:
    return GV0(i) if i < 32 else (GV1(i) if i < 256 else GV2(i))


def LV0(i: int) -> bytes:
    return bytes([0x40 | (i & 0x1F)])


def LV1(i: int) -> bytes:
    return bytes([0xC1, i & 0xFF])


def LV2(i: int) -> bytes:
    return bytes([0xC2]) + struct.pack("<H", i)


def LV(i: int) -> bytes:
    return LV0(i) if i < 32 else (LV1(i) if i < 256 else LV2(i))


def op(name: str, *params: bytes) -> bytes:
    return bytes([OP[name]]) + b"".join(params)


# --------------------------------------------------------------- framing
def direct_command(bytecodes: bytes, globals_: int, locals_: int, counter: int, reply: bool = True) -> bytes:
    header = struct.pack("<H", (globals_ & 0x3FF) | ((locals_ & 0x3F) << 10))
    body = struct.pack("<H", counter & 0xFFFF) + bytes([DIRECT_REPLY if reply else DIRECT_NO_REPLY]) + header + bytecodes
    if len(body) + 2 > MAX_MESSAGE:
        raise ValueError(f"direct command too long ({len(body) + 2} bytes, max {MAX_MESSAGE})")
    return struct.pack("<H", len(body)) + body


def system_command(command: int, payload: bytes, counter: int, reply: bool = True) -> bytes:
    body = struct.pack("<H", counter & 0xFFFF) + bytes([SYSTEM_REPLY if reply else SYSTEM_NO_REPLY, command]) + payload
    return struct.pack("<H", len(body)) + body


def parse_message(data: bytes) -> Tuple[int, int, bytes]:
    """(counter, type, rest) from a received message (with its length word)."""
    if len(data) < 5:
        raise ValueError("message too short")
    length = struct.unpack_from("<H", data, 0)[0]
    msg = data[2:2 + length]
    counter, typ = struct.unpack_from("<HB", msg, 0)
    return counter, typ, bytes(msg[3:])


class EV3Error(Exception):
    pass


# --------------------------------------------------------------- .rbf image
RBF_VERSION = 0x0068   # byte code version 1.04


def rbf_image(threads: List[Tuple[bytes, int]], globals_: int) -> bytes:
    """Build an .rbf program.  ``threads`` = [(bytecode, local bytes), ...];
    thread 1 is the main VMTHREAD and must end with OBJECT_END."""
    n = len(threads)
    header_size = 16 + 12 * n
    offset = header_size
    headers, code = b"", b""
    for bc, locals_ in threads:
        headers += struct.pack("<IHHI", offset, 0, 0, locals_)
        code += bc
        offset += len(bc)
    image = struct.pack("<4sIHHI", b"LEGO", header_size + len(code), RBF_VERSION, n, globals_) + headers + code
    return image


def parse_file_listing(text: str) -> List[Dict]:
    """LIST_FILES answers lines of 'md5 size_hex name' and 'folder/'."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.endswith("/"):
            if line not in ("./", "../"):
                out.append({"name": line[:-1], "dir": True, "size": 0})
            continue
        parts = line.split(" ", 2)
        if len(parts) == 3 and len(parts[0]) == 32:
            try:
                out.append({"name": parts[2], "dir": False, "size": int(parts[1], 16), "md5": parts[0]})
                continue
            except ValueError:
                pass
        out.append({"name": line, "dir": False, "size": 0})
    return out


def port_mask(ports) -> int:
    if isinstance(ports, int):
        return ports & 0x0F
    m = 0
    for ch in str(ports).upper():
        if ch in OUTPUT_PORTS:
            m |= OUTPUT_PORTS[ch]
    return m


def port_index(port) -> int:
    """'A'..'D' -> 0..3"""
    return "ABCD".index(str(port).upper()[0])


def hexs(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data)
