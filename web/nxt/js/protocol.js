/* OpenNXT - LEGO Mindstorms NXT protocol constants and helpers (browser port of
 * python/opennxt/protocol.py).  Plain script: runs from file:// and in Node tests. */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
(function (ns) {
  'use strict';

  const T = { DIRECT: 0x00, DIRECT_NOREPLY: 0x80, SYSTEM: 0x01, SYSTEM_NOREPLY: 0x81, REPLY: 0x02 };
  const CMD = {
    START_PROGRAM: 0x00, STOP_PROGRAM: 0x01, PLAY_SOUND_FILE: 0x02, PLAY_TONE: 0x03,
    SET_OUTPUT_STATE: 0x04, SET_INPUT_MODE: 0x05, GET_OUTPUT_STATE: 0x06, GET_INPUT_VALUES: 0x07,
    RESET_INPUT_SCALED_VALUE: 0x08, MESSAGE_WRITE: 0x09, RESET_MOTOR_POSITION: 0x0A,
    GET_BATTERY_LEVEL: 0x0B, STOP_SOUND_PLAYBACK: 0x0C, KEEP_ALIVE: 0x0D, LS_GET_STATUS: 0x0E,
    LS_WRITE: 0x0F, LS_READ: 0x10, GET_CURRENT_PROGRAM_NAME: 0x11, MESSAGE_READ: 0x13,
    OPEN_READ: 0x80, OPEN_WRITE: 0x81, READ: 0x82, WRITE: 0x83, CLOSE: 0x84, DELETE: 0x85,
    FIND_FIRST: 0x86, FIND_NEXT: 0x87, GET_FIRMWARE_VERSION: 0x88, OPEN_WRITE_LINEAR: 0x89,
    OPEN_WRITE_DATA: 0x8B, OPEN_APPEND_DATA: 0x8C, BOOT: 0x97, SET_BRICK_NAME: 0x98,
    GET_DEVICE_INFO: 0x9B, DELETE_USER_FLASH: 0xA0,
  };
  const NAMES = {};
  Object.keys(CMD).forEach(k => { NAMES[CMD[k]] = k; });

  const STATUS = {
    0x00: 'success', 0x20: 'pending communication transaction in progress', 0x40: 'mailbox queue is empty',
    0x81: 'no more handles', 0x82: 'no space', 0x83: 'no more files', 0x84: 'end of file expected',
    0x85: 'end of file', 0x86: 'not a linear file', 0x87: 'file not found', 0x88: 'handle already closed',
    0x89: 'no linear space', 0x8A: 'undefined error', 0x8B: 'file is busy', 0x8C: 'no write buffers',
    0x8D: 'append not possible', 0x8E: 'file is full', 0x8F: 'file exists', 0x90: 'module not found',
    0x91: 'out of boundary', 0x92: 'illegal file name', 0x93: 'illegal handle',
    0xBD: 'request failed (file not found or no running program)', 0xBE: 'unknown command opcode',
    0xBF: 'insane packet', 0xC0: 'data contains out-of-range values', 0xDD: 'communication bus error',
    0xDE: 'no free memory in communication buffer', 0xDF: 'specified channel/connection is not valid',
    0xE0: 'specified channel/connection not configured or busy', 0xEC: 'no active program',
    0xED: 'illegal size specified', 0xEE: 'illegal mailbox queue ID specified',
    0xEF: 'attempted to access invalid field of a structure', 0xF0: 'bad input or output specified',
    0xFB: 'insufficient memory available', 0xFF: 'bad arguments',
  };

  const SENSOR_TYPES = { none: 0x00, touch: 0x01, temperature: 0x02, reflection: 0x03, angle: 0x04,
    light: 0x05, light_passive: 0x06, sound: 0x07, sound_dba: 0x08, custom: 0x09, lowspeed: 0x0A,
    lowspeed_9v: 0x0B, color: 0x0D, color_red: 0x0E, color_green: 0x0F, color_blue: 0x10, color_none: 0x11 };
  const SENSOR_TYPE_NAMES = {}; Object.keys(SENSOR_TYPES).forEach(k => { SENSOR_TYPE_NAMES[SENSOR_TYPES[k]] = k; });
  const SENSOR_MODES = { raw: 0x00, bool: 0x20, edge: 0x40, pulse: 0x60, percent: 0x80, celsius: 0xA0, fahrenheit: 0xC0, angle: 0xE0 };
  const SENSOR_MODE_NAMES = {}; Object.keys(SENSOR_MODES).forEach(k => { SENSOR_MODE_NAMES[SENSOR_MODES[k]] = k; });
  const DEFAULT_MODE = { touch: 'bool', light: 'percent', light_passive: 'percent', sound: 'percent', sound_dba: 'percent',
    ultrasonic: 'raw', lowspeed_9v: 'raw', lowspeed: 'raw', color: 'raw', angle: 'angle', temperature: 'celsius', none: 'raw' };
  const COLOR_NAMES = { 1: 'black', 2: 'blue', 3: 'green', 4: 'yellow', 5: 'red', 6: 'white' };

  const MOTOR = { ON: 0x01, BRAKE: 0x02, REGULATED: 0x04 };
  const REG = { IDLE: 0, SPEED: 1, SYNC: 2 };
  const RUN = { IDLE: 0x00, RAMPUP: 0x10, RUNNING: 0x20, RAMPDOWN: 0x40 };
  const PORT_ALL = 0xFF;
  const USB = { VID: 0x0694, PID: 0x0002, EP_OUT: 1, EP_IN: 2, PACKET: 64 };
  const WRITE_CHUNK = 58;
  const BOOT_MAGIC = "Let's dance: SAMBA\0";

  class NxtError extends Error {
    constructor(command, status) {
      super((NAMES[command] || ('0x' + command.toString(16))) + ' failed: ' + (STATUS[status] || ('unknown status 0x' + status.toString(16))) + ' (0x' + status.toString(16).toUpperCase().padStart(2, '0') + ')');
      this.name = 'NxtError'; this.command = command; this.status = status;
    }
  }

  const enc = new TextEncoder(), dec = new TextDecoder('ascii');
  function name20(name) {
    const b = enc.encode(name);
    if (b.length > 19) throw new Error("file name '" + name + "' is longer than 19 characters");
    const out = new Uint8Array(20); out.set(b); return out;
  }
  function cstr(bytes) { let n = 0; while (n < bytes.length && bytes[n]) n++; return dec.decode(bytes.subarray(0, n)); }
  function u16(v) { return [v & 0xFF, (v >> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF]; }
  function rdU16(b, i) { return b[i] | (b[i + 1] << 8); }
  function rdI16(b, i) { const v = rdU16(b, i); return v & 0x8000 ? v - 0x10000 : v; }
  function rdU32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }
  function rdI32(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); }
  function s8(v) { return v & 0xFF; }
  function rdI8(v) { return v & 0x80 ? v - 256 : v; }

  function build(type, command, payload) {
    const p = payload ? Uint8Array.from(payload) : new Uint8Array(0);
    const out = new Uint8Array(2 + p.length); out[0] = type; out[1] = command; out.set(p, 2); return out;
  }
  function parseReply(data) {
    if (data.length < 3 || data[0] !== T.REPLY) throw new Error('not an NXT reply: ' + hex(data));
    return { command: data[1], status: data[2], payload: data.subarray(3) };
  }
  function btFrame(msg) { const out = new Uint8Array(msg.length + 2); out[0] = msg.length & 0xFF; out[1] = msg.length >> 8; out.set(msg, 2); return out; }
  function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' '); }
  function commandName(c) { return NAMES[c] || ('0x' + c.toString(16).toUpperCase()); }
  function isLinearFile(name) { return /\.(rxe|rso|ric|rpg|rtm|sys)$/i.test(name); }
  function sensorTypeCode(t) { if (typeof t === 'number') return t; if (t === 'ultrasonic') return SENSOR_TYPES.lowspeed_9v; return SENSOR_TYPES[t]; }
  function sensorModeCode(m) { return typeof m === 'number' ? m : SENSOR_MODES[m]; }
  function motorPort(p) { if (typeof p === 'number') return p; p = String(p).toUpperCase(); return p === 'ALL' ? PORT_ALL : { A: 0, B: 1, C: 2 }[p]; }
  function sensorPort(p) { p = Number(p); if (p < 1 || p > 4) throw new Error('sensor port must be 1..4'); return p - 1; }

  ns.protocol = { T, CMD, NAMES, STATUS, SENSOR_TYPES, SENSOR_TYPE_NAMES, SENSOR_MODES, SENSOR_MODE_NAMES,
    DEFAULT_MODE, COLOR_NAMES, MOTOR, REG, RUN, PORT_ALL, USB, WRITE_CHUNK, BOOT_MAGIC, NxtError,
    name20, cstr, u16, u32, rdU16, rdI16, rdU32, rdI32, s8, rdI8, build, parseReply, btFrame, hex,
    commandName, isLinearFile, sensorTypeCode, sensorModeCode, motorPort, sensorPort };
})(OpenNXT);
