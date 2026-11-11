/* OpenRCX - RCX infrared protocol, S-record firmware and RCXI program images.
 * Plain script (no modules) so it runs from file:// and in Node for tests.
 * Mirrors python/openrcx/protocol.py, firmware.py and image.py. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
(function (ns) {
  'use strict';

  const OP = {
    ALIVE: 0x10, GET_VALUE: 0x12, SET_MOTOR_POWER: 0x13, SET_VARIABLE: 0x14,
    GET_VERSIONS: 0x15, GET_MEMORY_MAP: 0x20, SET_MOTOR_ON_OFF: 0x21, SET_TIME: 0x22,
    PLAY_TONE: 0x23, BEGIN_TASK: 0x25, GET_BATTERY: 0x30, SET_TX_RANGE: 0x31,
    SET_SENSOR_TYPE: 0x32, SET_DISPLAY: 0x33, BEGIN_SUB: 0x35, DELETE_ALL_TASKS: 0x40,
    SET_SENSOR_MODE: 0x42, TRANSFER_DATA: 0x45, STOP_ALL_TASKS: 0x50, PLAY_SOUND: 0x51,
    SET_DATALOG_SIZE: 0x52, POWER_OFF: 0x60, DELETE_TASK: 0x61, DATALOG_NEXT: 0x62,
    DELETE_FIRMWARE: 0x65, DELETE_ALL_SUBS: 0x70, START_TASK: 0x71, BEGIN_FIRMWARE: 0x75,
    STOP_TASK: 0x81, SET_PROGRAM: 0x91, CLEAR_TIMER: 0xA1, UPLOAD_DATALOG: 0xA4,
    UNLOCK_FIRMWARE: 0xA5, SET_POWER_DOWN_DELAY: 0xB1, DELETE_SUB: 0xC1,
    CLEAR_SENSOR: 0xD1, SET_MOTOR_DIR: 0xE1, SET_MESSAGE: 0xF7,
  };
  const NAMES = {};
  Object.keys(OP).forEach(k => { NAMES[OP[k]] = k; });

  const NO_REPLY = new Set([OP.SET_MESSAGE, 0xB2]);
  const VERSIONS_KEY = [1, 3, 5, 7, 0x0B];
  const UNLOCK_KEY = [0x4C, 0x45, 0x47, 0x4F, 0xAE];           // "LEGO" + (R)
  const UNLOCK_REPLY = 'Just a bit off the block!';

  const SRC = { VARIABLE: 0, TIMER: 1, CONSTANT: 2, MOTOR_STATUS: 3, RANDOM: 4, PROGRAM: 8,
    SENSOR_VALUE: 9, SENSOR_TYPE: 10, SENSOR_MODE: 11, SENSOR_RAW: 12, SENSOR_BOOL: 13,
    WATCH: 14, MESSAGE: 15 };
  const SENSOR_TYPES = { none: 0, touch: 1, temperature: 2, light: 3, rotation: 4 };
  const SENSOR_MODES = { raw: 0, bool: 1, edge: 2, pulse: 3, percent: 4, celsius: 5,
    fahrenheit: 6, rotation: 7 };
  const SOUNDS = ['Click', 'Beep beep', 'Sweep down', 'Sweep up', 'Error buzz', 'Fast sweep up'];
  const MOTOR_BITS = { A: 1, B: 2, C: 4 };

  function opcodeName(op) {
    const b = op & 0xF7;
    return NAMES[b] || ('0x' + b.toString(16).toUpperCase().padStart(2, '0'));
  }

  function checksum8(bytes) {
    let s = 0;
    for (let i = 0; i < bytes.length; i++) s = (s + bytes[i]) & 0xFF;
    return s;
  }

  function buildPacket(body) {
    const out = [0x55, 0xFF, 0x00];
    for (const b of body) { out.push(b & 0xFF, (~b) & 0xFF); }
    const c = checksum8(body);
    out.push(c, (~c) & 0xFF);
    return Uint8Array.from(out);
  }

  function expectedReplyLength(body) {
    const op = body[0] & 0xF7;
    if (NO_REPLY.has(op)) return 0;
    switch (op) {
      case OP.BEGIN_TASK: case OP.BEGIN_SUB: case OP.TRANSFER_DATA: case OP.BEGIN_FIRMWARE:
      case OP.SET_DATALOG_SIZE: case OP.DATALOG_NEXT: return 1;
      case OP.GET_BATTERY: case OP.GET_VALUE: return 2;
      case OP.GET_VERSIONS: return 8;
      case OP.UNLOCK_FIRMWARE: return 25;
      case OP.GET_MEMORY_MAP: return 188;
      case OP.UPLOAD_DATALOG: return body.length === 5 ? (body[3] | (body[4] << 8)) * 3 : null;
      default: return 0;
    }
  }

  function verify(buf, start, p, expected) {
    const n = buf.length;
    if (p + 1 >= n || (buf[p] ^ buf[p + 1]) !== 0xFF) return null;
    const opcode = buf[p];
    const payload = [];
    let csum = opcode;
    let q = p + 2;
    if (expected !== null && expected !== undefined) {
      if (q + 2 * expected + 2 > n) return null;
      for (let i = 0; i < expected; i++) {
        if ((buf[q] ^ buf[q + 1]) !== 0xFF) return null;
        payload.push(buf[q]);
        csum = (csum + buf[q]) & 0xFF;
        q += 2;
      }
      if (buf[q] !== csum || buf[q + 1] !== ((~csum) & 0xFF)) return null;
      return { opcode, payload: Uint8Array.from(payload), start, end: q + 2 };
    }
    while (q + 1 < n) {
      if ((buf[q] ^ buf[q + 1]) !== 0xFF) return null;
      if (buf[q] === csum) return { opcode, payload: Uint8Array.from(payload), start, end: q + 2 };
      payload.push(buf[q]);
      csum = (csum + buf[q]) & 0xFF;
      q += 2;
    }
    return null;
  }

  /* Find a valid reply to cmdOpcode in buf (tolerates echo, noise, missing 0x55). */
  function findReply(buf, cmdOpcode, expected, offset) {
    const want = (~cmdOpcode) & 0xF7;
    const n = buf.length;
    let i = offset || 0;
    while (i < n) {
      let dataAt;
      if (buf[i] === 0x55 && i + 2 < n && buf[i + 1] === 0xFF && buf[i + 2] === 0x00) dataAt = i + 3;
      else if (buf[i] === 0xFF && i + 1 < n && buf[i + 1] === 0x00) dataAt = i + 2;
      else if (buf[i] === 0x00) dataAt = i + 1;
      else { i++; continue; }
      if (dataAt < n && (buf[dataAt] & 0xF7) === want) {
        const r = verify(buf, i, dataAt, expected);
        if (r) return r;
      }
      i++;
    }
    return null;
  }

  /* Decode one complete PC->RCX packet (simulator). */
  function parseCommand(packet) {
    let p;
    if (packet.length >= 3 && packet[0] === 0x55 && packet[1] === 0xFF && packet[2] === 0x00) p = 3;
    else if (packet.length >= 2 && packet[0] === 0xFF && packet[1] === 0x00) p = 2;
    else return null;
    const rest = packet.subarray(p);
    if (rest.length < 4 || rest.length % 2) return null;
    const body = [];
    for (let i = 0; i < rest.length; i += 2) {
      if ((rest[i] ^ rest[i + 1]) !== 0xFF) return null;
      if (i < rest.length - 2) body.push(rest[i]);
    }
    if (rest[rest.length - 2] !== checksum8(body)) return null;
    return Uint8Array.from(body);
  }

  function hex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
  }

  // --------------------------------------------------------------- S-records
  function parseSrec(text) {
    const mem = new Map();
    let title = '', lo = null, hi = null;
    const lines = text.split(/\r?\n/);
    for (let ln = 0; ln < lines.length; ln++) {
      const line = lines[ln].trim();
      if (!line) continue;
      if (line[0] !== 'S' || line.length < 8 || line.length % 2) throw new Error('line ' + (ln + 1) + ': not an S-record');
      const kind = line[1];
      const count = parseInt(line.substr(2, 2), 16);
      const bytes = [];
      for (let i = 0; i < count; i++) {
        const v = parseInt(line.substr(4 + i * 2, 2), 16);
        if (Number.isNaN(v)) throw new Error('line ' + (ln + 1) + ': bad hex');
        bytes.push(v);
      }
      if (bytes.length !== count) throw new Error('line ' + (ln + 1) + ': length mismatch');
      const body = bytes.slice(0, -1), csum = bytes[bytes.length - 1];
      let sum = count;
      for (const b of body) sum = (sum + b) & 0xFF;
      if ((sum ^ 0xFF) !== csum) throw new Error('line ' + (ln + 1) + ': checksum mismatch');
      if (kind === '0') {
        title = String.fromCharCode(...body.slice(2)).replace(/\0+$/, '');
      } else if (kind === '1' || kind === '2' || kind === '3') {
        const alen = { '1': 2, '2': 3, '3': 4 }[kind];
        let addr = 0;
        for (let i = 0; i < alen; i++) addr = (addr << 8) | body[i];
        for (let i = alen; i < body.length; i++) mem.set(addr + i - alen, body[i]);
        lo = lo === null ? addr : Math.min(lo, addr);
        const end = addr + body.length - alen;
        hi = hi === null ? end : Math.max(hi, end);
      } else if (kind === '7' || kind === '8' || kind === '9') {
        break;
      }
    }
    if (lo === null) throw new Error('no data records');
    if (hi - lo > 0x8000) throw new Error('image larger than 32 KB');
    const data = new Uint8Array(hi - lo);
    for (let a = lo; a < hi; a++) data[a - lo] = mem.get(a) || 0;
    let ck = 0;
    for (let i = 0; i < Math.min(data.length, 0x4C00); i++) ck = (ck + data[i]) & 0xFFFF;
    return { start: lo, data, title, checksum: ck };
  }

  // --------------------------------------------------------------- RCXI image
  function parseRcx(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) throw new Error('file too short');
    if (dv.getUint32(0, true) !== 0x49584352) throw new Error('not an RCXI (.rcx) file');
    const ver = dv.getUint16(4, true);
    if (ver > 0x0102) throw new Error('unsupported RCXI version');
    const nchunks = dv.getUint16(6, true), nsyms = dv.getUint16(8, true), target = bytes[10];
    const img = { target, chunks: [], variables: {}, size: 0 };
    let pos = 12;
    for (let i = 0; i < nchunks; i++) {
      const type = bytes[pos], number = bytes[pos + 1], length = dv.getUint16(pos + 2, true);
      pos += 4;
      if (type > 1) throw new Error('unknown chunk type ' + type);
      img.chunks.push({ type, number, data: bytes.slice(pos, pos + length), name: '' });
      img.size += length;
      pos += length + ((4 - length) & 3);
    }
    for (let i = 0; i < nsyms && pos + 4 <= bytes.length; i++) {
      const stype = bytes[pos], index = bytes[pos + 1], length = bytes[pos + 2];
      pos += 4;
      let name = '';
      for (let j = 0; j < length && bytes[pos + j]; j++) name += String.fromCharCode(bytes[pos + j]);
      pos += length;
      if (stype === 0 || stype === 1) {
        const c = img.chunks.find(c => c.type === stype && c.number === index);
        if (c) c.name = name;
      } else if (stype === 2) img.variables[index] = name;
    }
    return img;
  }

  function describeImage(img) {
    const t = { 0: 'RCX', 1: 'CyberMaster', 2: 'Scout', 3: 'RCX2', 4: 'Spybotics', 5: 'Swan' }[img.target] || ('target ' + img.target);
    const parts = img.chunks.map(c => (c.type === 0 ? 'task ' : 'sub ') + c.number + (c.name ? ' (' + c.name + ')' : '') + ': ' + c.data.length + ' B');
    return t + ' image, ' + img.chunks.length + ' chunk' + (img.chunks.length === 1 ? '' : 's') + ', ' + img.size + ' bytes' + (parts.length ? ' - ' + parts.join(', ') : '');
  }

  ns.protocol = { OP, NO_REPLY, VERSIONS_KEY, UNLOCK_KEY, UNLOCK_REPLY, SRC, SENSOR_TYPES,
    SENSOR_MODES, SOUNDS, MOTOR_BITS, opcodeName, checksum8, buildPacket, expectedReplyLength,
    findReply, parseCommand, hex, parseSrec, parseRcx, describeImage };
})(OpenRCX);
