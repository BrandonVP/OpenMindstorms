/* OpenEV3 - EV3 protocol: framing, bytecode parameter encoding, opcodes, .rbf (port of
 * python/openev3/protocol.py).  Plain script: runs from file:// and in Node tests. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const T = { DIRECT_REPLY: 0x00, DIRECT_NO_REPLY: 0x80, SYSTEM_REPLY: 0x01, SYSTEM_NO_REPLY: 0x81,
    REPLY_DIRECT: 0x02, REPLY_DIRECT_ERROR: 0x04, REPLY_SYSTEM: 0x03, REPLY_SYSTEM_ERROR: 0x05 };
  const USB = { VID: 0x0694, PID: 0x0005, REPORT: 1024 };
  const MAX_MESSAGE = 1024;
  const SYS = { BEGIN_DOWNLOAD: 0x92, CONTINUE_DOWNLOAD: 0x93, BEGIN_UPLOAD: 0x94, CONTINUE_UPLOAD: 0x95, BEGIN_GETFILE: 0x96,
    CONTINUE_GETFILE: 0x97, CLOSE_FILEHANDLE: 0x98, LIST_FILES: 0x99, CONTINUE_LIST_FILES: 0x9A, CREATE_DIR: 0x9B,
    DELETE_FILE: 0x9C, LIST_OPEN_HANDLES: 0x9D, WRITEMAILBOX: 0x9E, BLUETOOTHPIN: 0x9F, ENTERFWUPDATE: 0xA0 };
  const SYSTEM_STATUS = { 0: 'success', 1: 'unknown handle', 2: 'handle not ready', 3: 'corrupt file', 4: 'no handles available',
    5: 'no permission', 6: 'illegal path', 7: 'file exists', 8: 'end of file', 9: 'size error', 10: 'unknown error', 11: 'illegal filename', 12: 'illegal connection' };
  const OP = { ERROR: 0x00, NOP: 0x01, PROGRAM_STOP: 0x02, PROGRAM_START: 0x03, OBJECT_STOP: 0x04, OBJECT_START: 0x05, OBJECT_TRIG: 0x06,
    OBJECT_WAIT: 0x07, RETURN: 0x08, CALL: 0x09, OBJECT_END: 0x0A, SLEEP: 0x0B, PROGRAM_INFO: 0x0C, LABEL: 0x0D, PROBE: 0x0E, DO: 0x0F,
    ADD8: 0x10, ADD16: 0x11, ADD32: 0x12, ADDF: 0x13, SUB8: 0x14, SUB16: 0x15, SUB32: 0x16, SUBF: 0x17, MUL8: 0x18, MUL16: 0x19, MUL32: 0x1A,
    MULF: 0x1B, DIV8: 0x1C, DIV16: 0x1D, DIV32: 0x1E, DIVF: 0x1F, OR8: 0x20, OR16: 0x21, OR32: 0x22, AND8: 0x24, AND16: 0x25, AND32: 0x26,
    XOR8: 0x28, XOR16: 0x29, XOR32: 0x2A, RL8: 0x2C, RL16: 0x2D, RL32: 0x2E, INIT_BYTES: 0x2F, MOVE8_8: 0x30, MOVE8_16: 0x31, MOVE8_32: 0x32,
    MOVE8_F: 0x33, MOVE16_8: 0x34, MOVE16_16: 0x35, MOVE16_32: 0x36, MOVE16_F: 0x37, MOVE32_8: 0x38, MOVE32_16: 0x39, MOVE32_32: 0x3A,
    MOVE32_F: 0x3B, MOVEF_8: 0x3C, MOVEF_16: 0x3D, MOVEF_32: 0x3E, MOVEF_F: 0x3F, JR: 0x40, JR_FALSE: 0x41, JR_TRUE: 0x42, JR_NAN: 0x43,
    CP_LT8: 0x44, CP_LT16: 0x45, CP_LT32: 0x46, CP_LTF: 0x47, CP_GT8: 0x48, CP_GT16: 0x49, CP_GT32: 0x4A, CP_GTF: 0x4B, CP_EQ8: 0x4C,
    CP_EQ16: 0x4D, CP_EQ32: 0x4E, CP_EQF: 0x4F, CP_NEQ8: 0x50, CP_NEQ16: 0x51, CP_NEQ32: 0x52, CP_NEQF: 0x53, CP_LTEQ8: 0x54, CP_LTEQ16: 0x55,
    CP_LTEQ32: 0x56, CP_LTEQF: 0x57, CP_GTEQ8: 0x58, CP_GTEQ16: 0x59, CP_GTEQ32: 0x5A, CP_GTEQF: 0x5B, SELECT8: 0x5C, SELECT16: 0x5D,
    SELECT32: 0x5E, SELECTF: 0x5F, SYSTEM: 0x60, PORT_CNV_OUTPUT: 0x61, PORT_CNV_INPUT: 0x62, NOTE_TO_FREQ: 0x63, JR_LT8: 0x64, JR_LT16: 0x65,
    JR_LT32: 0x66, JR_LTF: 0x67, JR_GT8: 0x68, JR_GT16: 0x69, JR_GT32: 0x6A, JR_GTF: 0x6B, JR_EQ8: 0x6C, JR_EQ16: 0x6D, JR_EQ32: 0x6E, JR_EQF: 0x6F,
    JR_NEQ8: 0x70, JR_NEQ16: 0x71, JR_NEQ32: 0x72, JR_NEQF: 0x73, JR_LTEQ8: 0x74, JR_LTEQ16: 0x75, JR_LTEQ32: 0x76, JR_LTEQF: 0x77, JR_GTEQ8: 0x78,
    JR_GTEQ16: 0x79, JR_GTEQ32: 0x7A, JR_GTEQF: 0x7B, INFO: 0x7C, STRINGS: 0x7D, MEMORY_WRITE: 0x7E, MEMORY_READ: 0x7F, UI_FLUSH: 0x80, UI_READ: 0x81,
    UI_WRITE: 0x82, UI_BUTTON: 0x83, UI_DRAW: 0x84, TIMER_WAIT: 0x85, TIMER_READY: 0x86, TIMER_READ: 0x87, MATH: 0x8D, RANDOM: 0x8E, TIMER_READ_US: 0x8F,
    KEEP_ALIVE: 0x90, COM_READ: 0x91, COM_WRITE: 0x92, SOUND: 0x94, SOUND_TEST: 0x95, SOUND_READY: 0x96, INPUT_SAMPLE: 0x97, INPUT_DEVICE_LIST: 0x98,
    INPUT_DEVICE: 0x99, INPUT_READ: 0x9A, INPUT_TEST: 0x9B, INPUT_READY: 0x9C, INPUT_READSI: 0x9D, INPUT_READEXT: 0x9E, INPUT_WRITE: 0x9F,
    OUTPUT_GET_TYPE: 0xA0, OUTPUT_SET_TYPE: 0xA1, OUTPUT_RESET: 0xA2, OUTPUT_STOP: 0xA3, OUTPUT_POWER: 0xA4, OUTPUT_SPEED: 0xA5, OUTPUT_START: 0xA6,
    OUTPUT_POLARITY: 0xA7, OUTPUT_READ: 0xA8, OUTPUT_TEST: 0xA9, OUTPUT_READY: 0xAA, OUTPUT_POSITION: 0xAB, OUTPUT_STEP_POWER: 0xAC, OUTPUT_TIME_POWER: 0xAD,
    OUTPUT_STEP_SPEED: 0xAE, OUTPUT_TIME_SPEED: 0xAF, OUTPUT_STEP_SYNC: 0xB0, OUTPUT_TIME_SYNC: 0xB1, OUTPUT_CLR_COUNT: 0xB2, OUTPUT_GET_COUNT: 0xB3,
    OUTPUT_PRG_STOP: 0xB4, FILE: 0xC0, ARRAY: 0xC1, ARRAY_WRITE: 0xC2, ARRAY_READ: 0xC3, ARRAY_APPEND: 0xC4, MEMORY_USAGE: 0xC5, FILENAME: 0xC6,
    READ8: 0xC8, READ16: 0xC9, READ32: 0xCA, READF: 0xCB, WRITE8: 0xCC, WRITE16: 0xCD, WRITE32: 0xCE, WRITEF: 0xCF, COM_READY: 0xD0, COM_READDATA: 0xD1,
    COM_WRITEDATA: 0xD2, COM_GET: 0xD3, COM_SET: 0xD4, COM_TEST: 0xD5, COM_REMOVE: 0xD6, COM_WRITEFILE: 0xD7, MAILBOX_OPEN: 0xD8, MAILBOX_WRITE: 0xD9,
    MAILBOX_READ: 0xDA, MAILBOX_TEST: 0xDB, MAILBOX_READY: 0xDC, MAILBOX_CLOSE: 0xDD, TST: 0xFF };
  const OP_NAMES = {}; Object.keys(OP).forEach(k => { OP_NAMES[OP[k]] = k; });
  const UI_READ = { GET_VBATT: 0x01, GET_IBATT: 0x02, GET_OS_VERS: 0x03, GET_EVENT: 0x04, GET_TBATT: 0x05, GET_IINT: 0x06, GET_IMOTOR: 0x07, GET_STRING: 0x08,
    GET_HW_VERS: 0x09, GET_FW_VERS: 0x0A, GET_FW_BUILD: 0x0B, GET_OS_BUILD: 0x0C, GET_ADDRESS: 0x0D, GET_CODE: 0x0E, KEY: 0x0F, GET_SHUTDOWN: 0x10,
    GET_WARNING: 0x11, GET_LBATT: 0x12, TEXTBOX_READ: 0x15, GET_VERSION: 0x1A, GET_IP: 0x1B, GET_POWER: 0x1D, GET_SDCARD: 0x1E, GET_USBSTICK: 0x1F };
  const UI_WRITE = { WRITE_FLUSH: 0x01, FLOATVALUE: 0x02, STAMP: 0x03, PUT_STRING: 0x08, VALUE8: 0x09, VALUE16: 0x0A, VALUE32: 0x0B, VALUEF: 0x0C, ADDRESS: 0x0D,
    CODE: 0x0E, DOWNLOAD_END: 0x0F, SCREEN_BLOCK: 0x10, TEXTBOX_APPEND: 0x15, SET_BUSY: 0x16, SET_TESTPIN: 0x17, INIT_RUN: 0x18, UPDATE_RUN: 0x1A, LED: 0x1B,
    POWER: 0x1D, GRAPH_SAMPLE: 0x1E, TERMINAL: 0x1F };
  const UI_DRAW = { UPDATE: 0x00, CLEAN: 0x01, PIXEL: 0x02, LINE: 0x03, CIRCLE: 0x04, TEXT: 0x05, ICON: 0x06, PICTURE: 0x07, VALUE: 0x08, FILLRECT: 0x09, RECT: 0x0A,
    NOTIFICATION: 0x0B, QUESTION: 0x0C, KEYBOARD: 0x0D, BROWSE: 0x0E, VERTBAR: 0x0F, INVERSERECT: 0x10, SELECT_FONT: 0x11, TOPLINE: 0x12, FILLWINDOW: 0x13,
    SCROLL: 0x14, DOTLINE: 0x15, VIEW_VALUE: 0x16, VIEW_UNIT: 0x17, FILLCIRCLE: 0x18, STORE: 0x19, RESTORE: 0x1A, ICON_QUESTION: 0x1B, BMPFILE: 0x1C, POPUP: 0x1D,
    GRAPH_SETUP: 0x1E, GRAPH_DRAW: 0x1F, TEXTBOX: 0x20 };
  const UI_BUTTON = { SHORTPRESS: 0x01, LONGPRESS: 0x02, WAIT_FOR_PRESS: 0x03, FLUSH: 0x04, PRESS: 0x05, RELEASE: 0x06, GET_HORZ: 0x07, GET_VERT: 0x08, PRESSED: 0x09,
    SET_BACK_BLOCK: 0x0A, GET_BACK_BLOCK: 0x0B, TESTSHORTPRESS: 0x0C, TESTLONGPRESS: 0x0D, GET_BUMBED: 0x0E, GET_CLICK: 0x0F };
  const BUTTONS = { up: 1, enter: 2, down: 3, right: 4, left: 5, back: 6, any: 7 };
  const SOUND = { BREAK: 0, TONE: 1, PLAY: 2, REPEAT: 3, SERVICE: 4 };
  const INPUT_DEVICE = { GET_FORMAT: 2, CAL_MINMAX: 3, CAL_DEFAULT: 4, GET_TYPEMODE: 5, GET_SYMBOL: 6, CAL_MIN: 7, CAL_MAX: 8, SETUP: 9, CLR_ALL: 10, GET_RAW: 11,
    GET_CONNECTION: 12, STOP_ALL: 13, GET_NAME: 21, GET_MODENAME: 22, SET_RAW: 23, GET_FIGURES: 24, GET_CHANGES: 25, CLR_CHANGES: 26, READY_PCT: 27, READY_RAW: 28,
    READY_SI: 29, GET_MINMAX: 30, GET_BUMPS: 31 };
  const COM_GET = { GET_ON_OFF: 1, GET_VISIBLE: 2, GET_RESULT: 4, GET_PIN: 5, SEARCH_ITEMS: 8, SEARCH_ITEM: 9, FAVOUR_ITEMS: 10, FAVOUR_ITEM: 11, GET_ID: 12,
    GET_BRICKNAME: 13, GET_NETWORK: 14, GET_PRESENT: 15, GET_ENCRYPT: 16, CONNEC_ITEMS: 17, CONNEC_ITEM: 18, GET_INCOMING: 19, GET_MODE2: 20 };
  const COM_SET = { SET_ON_OFF: 1, SET_VISIBLE: 2, SET_SEARCH: 3, SET_PIN: 5, SET_PASSKEY: 6, SET_CONNECTION: 7, SET_BRICKNAME: 8, SET_MOVEUP: 9, SET_MOVEDOWN: 10,
    SET_ENCRYPT: 11, SET_SSID: 12, SET_MODE2: 13 };
  const INFO = { SET_ERROR: 1, GET_ERROR: 2, ERRORTEXT: 3, GET_VOLUME: 4, SET_VOLUME: 5, GET_MINUTES: 6, SET_MINUTES: 7 };
  const FILE = { OPEN_APPEND: 0, OPEN_READ: 1, OPEN_WRITE: 2, READ_VALUE: 3, WRITE_VALUE: 4, READ_TEXT: 5, WRITE_TEXT: 6, CLOSE: 7, LOAD_IMAGE: 8, GET_HANDLE: 9,
    MAKE_FOLDER: 10, GET_POOL: 11, GET_FOLDERS: 13, GET_SUBFOLDER_NAME: 15, WRITE_LOG: 16, CLOSE_LOG: 17, GET_IMAGE: 18, GET_ITEM: 19, OPEN_LOG: 27, READ_BYTES: 28,
    WRITE_BYTES: 29, REMOVE: 30, MOVE: 31 };
  const PROGRAM_INFO = { OBJ_STOP: 0, OBJ_START: 4, GET_STATUS: 22, GET_SPEED: 23, GET_PRGRESULT: 24, SET_INSTR: 25 };
  const MATH = { EXP: 1, MOD: 2, FLOOR: 3, CEIL: 4, ROUND: 5, ABS: 6, NEGATE: 7, SQRT: 8, LOG: 9, LN: 10, SIN: 11, COS: 12, TAN: 13, ASIN: 14, ACOS: 15, ATAN: 16,
    MOD8: 17, MOD16: 18, MOD32: 19, POW: 20, TRUNC: 21 };
  const LED_PATTERNS = { off: 0, green: 1, red: 2, orange: 3, green_flash: 4, red_flash: 5, orange_flash: 6, green_pulse: 7, red_pulse: 8, orange_pulse: 9 };
  const USER_SLOT = 1;
  const DEVICE_TYPES = { 1: 'nxt-touch', 2: 'nxt-light', 3: 'nxt-sound', 4: 'nxt-color', 5: 'nxt-ultrasonic', 6: 'nxt-temperature', 7: 'large-motor', 8: 'medium-motor',
    16: 'touch', 29: 'color', 30: 'ultrasonic', 32: 'gyro', 33: 'infrared', 99: 'energy-meter', 100: 'nxt-iic', 121: 'unknown', 125: 'unknown', 126: 'none', 127: 'error' };
  const SENSOR_MODES = {
    16: { 0: ['touch', '', 1], 1: ['bump', 'count', 1] },
    29: { 0: ['reflect', '%', 1], 1: ['ambient', '%', 1], 2: ['color', '', 1], 3: ['ref-raw', '', 2], 4: ['rgb-raw', '', 3], 5: ['cal', '', 4] },
    30: { 0: ['distance', 'cm', 1], 1: ['distance', 'in', 1], 2: ['listen', '', 1], 3: ['single-cm', 'cm', 1], 4: ['single-in', 'in', 1] },
    32: { 0: ['angle', '°', 1], 1: ['rate', '°/s', 1], 2: ['fast', '', 1], 3: ['rate-angle', '', 2], 4: ['cal', '', 1] },
    33: { 0: ['proximity', '%', 1], 1: ['seek', '', 8], 2: ['remote', '', 4] },
    1: { 0: ['touch', '', 1], 1: ['bump', 'count', 1] }, 2: { 0: ['reflect', '%', 1], 1: ['ambient', '%', 1] }, 3: { 0: ['db', '%', 1], 1: ['dba', '%', 1] },
    4: { 0: ['reflect', '%', 1], 1: ['ambient', '%', 1], 2: ['color', '', 1] }, 5: { 0: ['distance', 'cm', 1], 1: ['distance', 'in', 1] },
    6: { 0: ['temperature', '°C', 1], 1: ['temperature', '°F', 1] },
    7: { 0: ['degrees', '°', 1], 1: ['rotations', 'rot', 1], 2: ['power', '%', 1] }, 8: { 0: ['degrees', '°', 1], 1: ['rotations', 'rot', 1], 2: ['power', '%', 1] },
  };
  const COLOR_NAMES = { 0: 'none', 1: 'black', 2: 'blue', 3: 'green', 4: 'yellow', 5: 'red', 6: 'white', 7: 'brown' };
  const OUTPUT_PORTS = { A: 1, B: 2, C: 4, D: 8 };

  // ---- parameter encoding (returns arrays of bytes)
  const u16 = v => [v & 0xFF, (v >> 8) & 0xFF];
  const i32 = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];
  const f32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return Array.from(b); };
  const LC0 = v => { if (v < -32 || v > 31) throw new Error('LC0 range'); return [v & 0x3F]; };
  const LC1 = v => [0x81, v & 0xFF];
  const LC2 = v => [0x82, ...u16(v)];
  const LC4 = v => [0x83, ...i32(v)];
  const LCF = v => { const a = [0x83, ...f32(v)]; a.isF = true; return a; };   // isF: lets the assembler listing print it as a float
  const LCS = s => [0x84, ...Array.from(new TextEncoder().encode(String(s))), 0];
  const LC = v => { v = Math.round(v); if (v >= -32 && v <= 31) return LC0(v); if (v >= -128 && v <= 127) return LC1(v); if (v >= -32768 && v <= 32767) return LC2(v); return LC4(v); };
  const GV0 = i => [0x60 | (i & 0x1F)];
  const GV1 = i => [0xE1, i & 0xFF];
  const GV2 = i => [0xE2, ...u16(i)];
  const GV = i => i < 32 ? GV0(i) : (i < 256 ? GV1(i) : GV2(i));
  const LV0 = i => [0x40 | (i & 0x1F)];
  const LV1 = i => [0xC1, i & 0xFF];
  const LV2 = i => [0xC2, ...u16(i)];
  const LV = i => i < 32 ? LV0(i) : (i < 256 ? LV1(i) : LV2(i));
  const op = (name, ...params) => { if (!(name in OP)) throw new Error('unknown opcode ' + name); return [OP[name]].concat(...params); };

  function directCommand(bytecodes, globals, locals, counter, reply) {
    const header = u16((globals & 0x3FF) | ((locals & 0x3F) << 10));
    const body = [...u16(counter & 0xFFFF), reply === false ? T.DIRECT_NO_REPLY : T.DIRECT_REPLY, ...header, ...bytecodes];
    if (body.length + 2 > MAX_MESSAGE) throw new Error('direct command too long (' + (body.length + 2) + ' bytes, max ' + MAX_MESSAGE + ')');
    return Uint8Array.from([...u16(body.length), ...body]);
  }
  function systemCommand(command, payload, counter, reply) {
    const body = [...u16(counter & 0xFFFF), reply === false ? T.SYSTEM_NO_REPLY : T.SYSTEM_REPLY, command, ...payload];
    return Uint8Array.from([...u16(body.length), ...body]);
  }
  function parseMessage(data) {
    if (data.length < 5) throw new Error('message too short');
    const length = data[0] | (data[1] << 8);
    const msg = data.subarray(2, 2 + length);
    return { counter: msg[0] | (msg[1] << 8), type: msg[2], rest: msg.subarray(3) };
  }
  function rbfImage(threads, globals) {
    const n = threads.length, headerSize = 16 + 12 * n;
    let offset = headerSize; const headers = [], code = [];
    for (const [bc, locals] of threads) { headers.push(...i32(offset), ...u16(0), ...u16(0), ...i32(locals)); code.push(...bc); offset += bc.length; }
    return Uint8Array.from([0x4C, 0x45, 0x47, 0x4F, ...i32(headerSize + code.length), ...u16(0x0068), ...u16(n), ...i32(globals), ...headers, ...code]);
  }
  function parseFileListing(text) {
    const out = [];
    for (let line of text.split('\n')) {
      line = line.trim(); if (!line) continue;
      if (line.endsWith('/')) { if (line !== './' && line !== '../') out.push({ name: line.slice(0, -1), dir: true, size: 0 }); continue; }
      const m = /^([0-9a-fA-F]{32}) ([0-9a-fA-F]{8}) (.+)$/.exec(line);
      if (m) out.push({ name: m[3], dir: false, size: parseInt(m[2], 16), md5: m[1] }); else out.push({ name: line, dir: false, size: 0 });
    }
    return out;
  }
  const portMask = ports => { if (typeof ports === 'number') return ports & 0x0F; let m = 0; for (const ch of String(ports).toUpperCase()) m |= OUTPUT_PORTS[ch] || 0; return m; };
  const portIndex = p => 'ABCD'.indexOf(String(p).toUpperCase()[0]);
  const cstr = b => { let n = 0; while (n < b.length && b[n]) n++; return new TextDecoder().decode(b.subarray(0, n)); };
  const rdF = (b, i) => new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat32(i, true);
  const rdI32 = (b, i) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(i, true);
  const rdI8 = v => v & 0x80 ? v - 256 : v;
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');

  ns.protocol = { T, USB, MAX_MESSAGE, SYS, SYSTEM_STATUS, OP, OP_NAMES, UI_READ, UI_WRITE, UI_DRAW, UI_BUTTON, BUTTONS, SOUND, INPUT_DEVICE, COM_GET, COM_SET,
    INFO, FILE, PROGRAM_INFO, MATH, LED_PATTERNS, USER_SLOT, DEVICE_TYPES, SENSOR_MODES, COLOR_NAMES, OUTPUT_PORTS,
    u16, i32, f32, LC0, LC1, LC2, LC4, LCF, LCS, LC, GV0, GV1, GV2, GV, LV0, LV1, LV2, LV, op, directCommand, systemCommand, parseMessage, rbfImage,
    parseFileListing, portMask, portIndex, cstr, rdF, rdI32, rdI8, hex };
})(OpenEV3);
