/* OpenEV3 - a small lms2012 virtual machine for the in-browser simulator
 * (port of python/openev3/vm.py).  Runs the bytecode subset OpenEV3 generates. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;

  class VMError extends Error { constructor(m) { super(m); this.name = 'VMError'; } }

  class BrickState {
    constructor() {
      this.name = 'EV3'; this.fw = 'V1.09H'; this.hw = 'V0.60'; this.os = 'Linux 2.6.33-rc';
      this.batteryV = 7.9; this.batteryPct = 95; this.led = 1; this.volume = 50; this.display = []; this.sounds = [];
      this.buttons = { up: false, enter: false, down: false, right: false, left: false, back: false };
      this.inputs = [0, 1, 2, 3].map(() => ({ type: 126, mode: 0, values: [0] }));
      this.motors = [0, 1, 2, 3].map(i => ({ type: i < 3 ? 7 : 126, power: 0, speed: 0, running: false, tacho: 0, polarity: 1 }));
      this.files = { '../prjs/BrkProg_SAVE/Demo.rpf': new Uint8Array(64) };
      this.runningProgram = null; this.sleepMinutes = 30; this.log = []; this.onChange = null;
      this.clock = () => performance.now() / 1000;
    }
  }

  class VM {
    constructor(brick, globalsSize, localsSize, code, sleeper) {
      this.b = brick; this.g = new Uint8Array(globalsSize || 0); this.l = new Uint8Array(localsSize || 0);
      this.gv = new DataView(this.g.buffer); this.lv = new DataView(this.l.buffer);
      this.code = code; this.pc = 0; this.sleeper = sleeper || null; this.stopped = false; this.steps = 0;
      this.pendingSleep = 0;
    }
    byte() { return this.code[this.pc++]; }
    param() {
      const b = this.byte();
      if ((b & 0x80) === 0) {
        if (b & 0x40) return { mem: b & 0x20 ? 'g' : 'l', off: b & 0x1F };
        const v = b & 0x3F; return v & 0x20 ? v - 64 : v;
      }
      if (b & 0x40) {
        const mem = b & 0x20 ? 'g' : 'l'; const size = b & 0x07; let idx;
        if (size === 1) idx = this.byte(); else if (size === 2) { idx = this.code[this.pc] | (this.code[this.pc + 1] << 8); this.pc += 2; }
        else { idx = (this.code[this.pc] | (this.code[this.pc + 1] << 8) | (this.code[this.pc + 2] << 16) | (this.code[this.pc + 3] << 24)) >>> 0; this.pc += 4; }
        return { mem, off: idx };
      }
      const size = b & 0x07;
      if (size === 0 || b === 0x84) { let end = this.pc; while (end < this.code.length && this.code[end]) end++; const s = new TextDecoder().decode(this.code.subarray(this.pc, end)); this.pc = end + 1; return s; }
      const dv = new DataView(this.code.buffer, this.code.byteOffset, this.code.byteLength);
      let v;
      if (size === 1) { v = dv.getInt8(this.pc); this.pc += 1; } else if (size === 2) { v = dv.getInt16(this.pc, true); this.pc += 2; } else { v = dv.getInt32(this.pc, true); this.pc += 4; }
      return v;
    }
    isRef(p) { return p !== null && typeof p === 'object'; }
    val(size, f) { const p = this.param(); return this.isRef(p) ? this.read(p, size || 4, f) : p; }
    ref() { const p = this.param(); if (!this.isRef(p)) throw new VMError('expected a variable at ' + this.pc); return p; }
    read(r, size, f) { const dv = r.mem === 'g' ? this.gv : this.lv; if (size === 1) return dv.getInt8(r.off); if (size === 2) return dv.getInt16(r.off, true); return f ? dv.getFloat32(r.off, true) : dv.getInt32(r.off, true); }
    write(r, value, size, f) {
      const dv = r.mem === 'g' ? this.gv : this.lv;
      if (f) { dv.setFloat32(r.off, value, true); return; }
      value = Math.trunc(value); const lim = { 1: 0x7F, 2: 0x7FFF, 4: 0x7FFFFFFF }[size]; value = Math.max(-lim - 1, Math.min(lim, value));
      if (size === 1) dv.setInt8(r.off, value); else if (size === 2) dv.setInt16(r.off, value, true); else dv.setInt32(r.off, value, true);
    }
    writeStr(r, s, max) { const mem = r.mem === 'g' ? this.g : this.l; const b = new TextEncoder().encode(String(s)).subarray(0, Math.max(0, max - 1)); mem.set(b, r.off); mem[r.off + b.length] = 0; }
    readStr(r) { const mem = r.mem === 'g' ? this.g : this.l; let n = r.off; while (n < mem.length && mem[n]) n++; return new TextDecoder().decode(mem.subarray(r.off, n)); }
    sval() { const p = this.param(); return this.isRef(p) ? this.readStr(p) : String(p); }

    async run(maxSteps) {
      maxSteps = maxSteps || 200000;
      while (this.pc < this.code.length && !this.stopped) {
        if (++this.steps > maxSteps) throw new VMError('program ran too long (infinite loop?)');
        const opc = this.byte(); const name = P.OP_NAMES[opc]; const h = name && H[name];
        if (!h) throw new VMError('unsupported opcode 0x' + opc.toString(16) + (name ? ' (' + name + ')' : '') + ' at ' + (this.pc - 1));
        h.call(this);
        if (this.pendingSleep) { const s = this.pendingSleep; this.pendingSleep = 0; if (this.sleeper) await this.sleeper(s); }
      }
    }
    jump(taken, off) { if (taken) this.pc += off; }
    ports(mask) { const out = []; for (let i = 0; i < 4; i++) if (mask & (1 << i)) out.push(i); return out; }
    input(no) { if (no < 4) return this.b.inputs[no]; if (no >= 16 && no < 20) { const m = this.b.motors[no - 16]; return { type: m.type, mode: 0, values: [m.tacho] }; } return { type: 126, mode: 0, values: [0] }; }
  }

  const H = {};
  const cmpjr = (size, f, fn) => function () { const a = this.val(size, f), b = this.val(size, f), off = this.val(4); this.jump(fn(a, b), off); };
  const cp = (size, f, fn) => function () { const a = this.val(size, f), b = this.val(size, f), r = this.ref(); this.write(r, fn(a, b) ? 1 : 0, 1); };
  const arith = (size, f, fn) => function () { const a = this.val(size, f), b = this.val(size, f), r = this.ref(); let v; try { v = fn(a, b); } catch (e) { v = f ? NaN : 0; } if (!f && !Number.isFinite(v)) v = 0; this.write(r, v, size, f); };
  const move = (s1, f1, s2, f2) => function () { const v = this.val(s1, f1), r = this.ref(); this.write(r, v, s2, f2); };
  const sizes = { 8: [1, false], 16: [2, false], 32: [4, false], F: [4, true] };
  for (const [suf, [sz, f]] of Object.entries(sizes)) {
    H['JR_LT' + suf] = cmpjr(sz, f, (a, b) => a < b); H['JR_GT' + suf] = cmpjr(sz, f, (a, b) => a > b); H['JR_EQ' + suf] = cmpjr(sz, f, (a, b) => a === b);
    H['JR_NEQ' + suf] = cmpjr(sz, f, (a, b) => a !== b); H['JR_LTEQ' + suf] = cmpjr(sz, f, (a, b) => a <= b); H['JR_GTEQ' + suf] = cmpjr(sz, f, (a, b) => a >= b);
    H['CP_LT' + suf] = cp(sz, f, (a, b) => a < b); H['CP_GT' + suf] = cp(sz, f, (a, b) => a > b); H['CP_EQ' + suf] = cp(sz, f, (a, b) => a === b);
    H['CP_NEQ' + suf] = cp(sz, f, (a, b) => a !== b); H['CP_LTEQ' + suf] = cp(sz, f, (a, b) => a <= b); H['CP_GTEQ' + suf] = cp(sz, f, (a, b) => a >= b);
    H['ADD' + suf] = arith(sz, f, (a, b) => a + b); H['SUB' + suf] = arith(sz, f, (a, b) => a - b); H['MUL' + suf] = arith(sz, f, (a, b) => a * b);
    H['DIV' + suf] = arith(sz, f, (a, b) => f ? a / b : Math.trunc(a / b));
    if (!f) { H['AND' + suf] = arith(sz, f, (a, b) => a & b); H['OR' + suf] = arith(sz, f, (a, b) => a | b); H['XOR' + suf] = arith(sz, f, (a, b) => a ^ b); }
    for (const [suf2, [sz2, f2]] of Object.entries(sizes)) H['MOVE' + suf + '_' + suf2] = move(sz, f, sz2, f2);
  }
  H.NOP = function () {};
  H.OBJECT_END = function () { this.stopped = true; };
  H.RETURN = function () { this.stopped = true; };
  H.PROGRAM_STOP = function () { this.val(2); this.b.runningProgram = null; this.b.log.push('PROGRAM_STOP'); };
  H.PROGRAM_START = function () { const slot = this.val(2); this.val(4); this.val(4); this.val(1); this.b.log.push('PROGRAM_START slot ' + slot); };
  H.OBJECT_START = function () { this.val(2); };
  H.OBJECT_STOP = function () { this.val(2); };
  H.SLEEP = function () {};
  H.KEEP_ALIVE = function () { this.write(this.ref(), this.b.sleepMinutes, 1); };
  H.TST = function () { this.val(1); };
  H.JR = function () { const off = this.val(4); this.jump(true, off); };
  H.JR_FALSE = function () { const v = this.val(1), off = this.val(4); this.jump(v === 0, off); };
  H.JR_TRUE = function () { const v = this.val(1), off = this.val(4); this.jump(v !== 0, off); };
  H.JR_NAN = function () { const v = this.val(4, true), off = this.val(4); this.jump(Number.isNaN(v), off); };
  H.MATH = function () {
    const sub = this.val(1);
    if (sub === P.MATH.POW || sub === P.MATH.MOD) { const a = this.val(4, true), b = this.val(4, true), r = this.ref(); this.write(r, sub === P.MATH.POW ? Math.pow(a, b) : a % b, 4, true); return; }
    if (sub === P.MATH.MOD8 || sub === P.MATH.MOD16 || sub === P.MATH.MOD32) { const size = { 17: 1, 18: 2, 19: 4 }[sub]; const a = this.val(size), b = this.val(size), r = this.ref(); this.write(r, b ? a % b : 0, size); return; }
    const a = this.val(4, true), r = this.ref();
    const fn = { 1: Math.exp, 3: Math.floor, 4: Math.ceil, 5: Math.round, 6: Math.abs, 7: x => -x, 8: Math.sqrt, 9: Math.log10, 10: Math.log, 11: x => Math.sin(x * Math.PI / 180),
      12: x => Math.cos(x * Math.PI / 180), 13: x => Math.tan(x * Math.PI / 180), 14: x => Math.asin(x) * 180 / Math.PI, 15: x => Math.acos(x) * 180 / Math.PI, 16: x => Math.atan(x) * 180 / Math.PI, 21: Math.trunc }[sub];
    if (!fn) throw new VMError('MATH ' + sub);
    this.write(r, fn(a), 4, true);
  };
  H.RANDOM = function () { const lo = this.val(2), hi = this.val(2), r = this.ref(); const a = Math.min(lo, hi), b = Math.max(lo, hi); this.write(r, a + Math.floor(Math.random() * (b - a + 1)), 2); };
  H.STRINGS = function () {
    const sub = this.val(1);
    if (sub === 2) { const a = this.sval(), b = this.sval(), size = this.val(1), r = this.ref(); this.writeStr(r, a + b, size); }
    else if (sub === 3) { const a = this.sval(), b = this.sval(), r = this.ref(); this.write(r, a === b ? 1 : 0, 1); }
    else if (sub === 5) { const v = this.val(4, true); this.val(1); const dec = this.val(1), r = this.ref(); this.writeStr(r, v.toFixed(dec), 32); }
    else if (sub === 6) { const v = this.val(2); this.val(1); const r = this.ref(); this.writeStr(r, String(v), 32); }
    else throw new VMError('STRINGS ' + sub);
  };
  H.TIMER_WAIT = function () { const ms = this.val(4), r = this.ref(); this.pendingSleep = ms / 1000; this.write(r, 0, 4); };
  H.TIMER_READY = function () { this.val(4); };
  H.TIMER_READ = function () { this.write(this.ref(), Math.floor(this.b.clock() * 1000) % 2147483647, 4); };
  H.TIMER_READ_US = function () { this.write(this.ref(), Math.floor(this.b.clock() * 1e6) % 2147483647, 4); };
  H.UI_READ = function () {
    const sub = this.val(1), b = this.b, R = P.UI_READ;
    if (sub === R.GET_VBATT) this.write(this.ref(), b.batteryV, 4, true);
    else if (sub === R.GET_LBATT) this.write(this.ref(), b.batteryPct, 1);
    else if (sub === R.GET_IBATT) this.write(this.ref(), 0.2, 4, true);
    else if (sub === R.GET_TBATT) this.write(this.ref(), 25, 4, true);
    else if (sub === R.GET_FW_VERS) { const n = this.val(1); this.writeStr(this.ref(), b.fw, n); }
    else if (sub === R.GET_HW_VERS) { const n = this.val(1); this.writeStr(this.ref(), b.hw, n); }
    else if (sub === R.GET_OS_VERS) { const n = this.val(1); this.writeStr(this.ref(), b.os, n); }
    else if (sub === R.GET_FW_BUILD || sub === R.GET_OS_BUILD || sub === R.GET_VERSION || sub === R.GET_IP) { const n = this.val(1); this.writeStr(this.ref(), 'sim', n); }
    else if (sub === R.GET_SDCARD || sub === R.GET_USBSTICK) { this.write(this.ref(), 0, 1); this.write(this.ref(), 0, 4); this.write(this.ref(), 0, 4); }
    else throw new VMError('UI_READ ' + sub);
  };
  H.UI_WRITE = function () {
    const sub = this.val(1), b = this.b, W = P.UI_WRITE;
    if (sub === W.LED) { b.led = this.val(1); b.log.push('LED ' + b.led); }
    else if (sub === W.PUT_STRING) b.log.push('PUT_STRING ' + this.sval());
    else if (sub === W.VALUE8 || sub === W.VALUE16 || sub === W.VALUE32) this.val();
    else if (sub === W.VALUEF) this.val(4, true);
    else if (sub === W.WRITE_FLUSH) { /* nothing */ }
    else if (sub === W.SET_BUSY) this.val(1);
    else throw new VMError('UI_WRITE ' + sub);
  };
  H.UI_DRAW = function () {
    const sub = this.val(1), b = this.b, D = P.UI_DRAW;
    if (sub === D.UPDATE) { /* nothing */ }
    else if (sub === D.CLEAN) b.display = [];
    else if (sub === D.FILLWINDOW) { this.val(1); this.val(2); this.val(2); b.display = []; }
    else if (sub === D.SELECT_FONT) this.val(1);
    else if (sub === D.TEXT) { this.val(1); const x = this.val(2), y = this.val(2), s = this.sval(); b.display.push('(' + x + ',' + y + ') ' + s); }
    else if (sub === D.VALUE) { this.val(1); const x = this.val(2), y = this.val(2), v = this.val(4, true); this.val(1); const dec = this.val(1); b.display.push('(' + x + ',' + y + ') ' + v.toFixed(dec)); }
    else if (sub === D.PIXEL) { this.val(1); this.val(2); this.val(2); }
    else if (sub === D.LINE || sub === D.RECT || sub === D.FILLRECT || sub === D.INVERSERECT || sub === D.DOTLINE) { this.val(1); this.val(2); this.val(2); this.val(2); this.val(2); if (sub === D.DOTLINE) { this.val(2); this.val(2); } }
    else if (sub === D.CIRCLE || sub === D.FILLCIRCLE) { this.val(1); this.val(2); this.val(2); this.val(2); }
    else if (sub === D.TOPLINE) this.val(1);
    else if (sub === D.BMPFILE) { this.val(1); this.val(2); this.val(2); b.display.push('picture ' + this.sval()); }
    else if (sub === D.ICON) { this.val(1); this.val(2); this.val(2); this.val(1); this.val(1); }
    else if (sub === D.STORE || sub === D.RESTORE) this.val(1);
    else throw new VMError('UI_DRAW ' + sub);
  };
  H.UI_BUTTON = function () {
    const sub = this.val(1), b = this.b, B = P.UI_BUTTON;
    const nameOf = v => Object.keys(P.BUTTONS).find(k => P.BUTTONS[k] === v);
    if (sub === B.PRESSED) { const btn = this.val(1), r = this.ref(); const n = nameOf(btn); this.write(r, (n === 'any' ? Object.values(b.buttons).some(x => x) : !!b.buttons[n]) ? 1 : 0, 1); }
    else if ([B.SHORTPRESS, B.LONGPRESS, B.GET_BUMBED, B.TESTSHORTPRESS, B.TESTLONGPRESS].includes(sub)) { const btn = this.val(1), r = this.ref(); const n = nameOf(btn); this.write(r, b.buttons[n] ? 1 : 0, 1); if (b.buttons[n]) b.buttons[n] = false; }
    else if (sub === B.WAIT_FOR_PRESS || sub === B.FLUSH) { /* nothing */ }
    else if (sub === B.GET_HORZ || sub === B.GET_VERT) this.write(this.ref(), 0, 2);
    else throw new VMError('UI_BUTTON ' + sub);
  };
  H.SOUND = function () {
    const sub = this.val(1), b = this.b, S = P.SOUND;
    if (sub === S.TONE) { const vol = this.val(1), hz = this.val(2), ms = this.val(2); b.sounds.push({ tone: hz, ms, vol }); }
    else if (sub === S.PLAY || sub === S.REPEAT) { const vol = this.val(1), name = this.sval(); b.sounds.push({ file: name, vol, repeat: sub === S.REPEAT }); }
    else if (sub === S.BREAK) b.sounds.push({ stop: true });
    else throw new VMError('SOUND ' + sub);
  };
  H.SOUND_TEST = function () { this.write(this.ref(), 0, 1); };
  H.SOUND_READY = function () {};
  H.INPUT_DEVICE = function () {
    const sub = this.val(1), I = P.INPUT_DEVICE;
    if (sub === I.GET_TYPEMODE) { this.val(1); const no = this.val(1); const d = this.input(no); this.write(this.ref(), d.type, 1); this.write(this.ref(), d.mode, 1); }
    else if (sub === I.READY_SI || sub === I.READY_RAW || sub === I.READY_PCT) {
      this.val(1); const no = this.val(1); this.val(1); const mode = this.val(1), n = this.val(1); const d = this.input(no);
      if (mode !== -1 && no < 4) d.mode = mode;
      for (let i = 0; i < n; i++) { const v = d.values[i] || 0; const r = this.ref(); if (sub === I.READY_SI) this.write(r, v, 4, true); else this.write(r, Math.trunc(v), 1); }
    }
    else if (sub === I.GET_NAME) { this.val(1); const no = this.val(1), n = this.val(1); this.writeStr(this.ref(), P.DEVICE_TYPES[this.input(no).type] || '?', n); }
    else if (sub === I.GET_MODENAME) { this.val(1); const no = this.val(1), mode = this.val(1), n = this.val(1); const d = this.input(no); this.writeStr(this.ref(), ((P.SENSOR_MODES[d.type] || {})[mode] || ['?'])[0], n); }
    else if (sub === I.CLR_ALL || sub === I.STOP_ALL) this.val(1);
    else if (sub === I.GET_CONNECTION) { this.val(1); const no = this.val(1); this.write(this.ref(), this.input(no).type === 126 ? 0 : 1, 1); }
    else if (sub === I.CLR_CHANGES) { this.val(1); this.val(1); }
    else throw new VMError('INPUT_DEVICE ' + sub);
  };
  H.INPUT_READSI = function () { this.val(1); const no = this.val(1); this.val(1); const mode = this.val(1); const d = this.input(no); if (mode !== -1 && no < 4) d.mode = mode; this.write(this.ref(), d.values[0] || 0, 4, true); };
  H.INPUT_READ = function () { this.val(1); const no = this.val(1); this.val(1); this.val(1); const d = this.input(no); this.write(this.ref(), Math.trunc(d.values[0] || 0), 1); };
  H.INPUT_DEVICE_LIST = function () { const n = this.val(1), r = this.ref(), chg = this.ref(); const mem = r.mem === 'g' ? this.g : this.l; for (let i = 0; i < Math.min(n, 8); i++) mem[r.off + i] = this.input(i < 4 ? i : 12 + i).type & 0xFF; this.write(chg, 0, 1); };
  H.OUTPUT_GET_TYPE = function () { this.val(1); const no = this.val(1); this.write(this.ref(), this.b.motors[no].type, 1); };
  H.OUTPUT_SET_TYPE = function () { this.val(1); const no = this.val(1); this.b.motors[no].type = this.val(1); };
  H.OUTPUT_RESET = function () { this.val(1); const m = this.val(1); this.ports(m).forEach(p => { this.b.motors[p].tacho = 0; }); };
  H.OUTPUT_STOP = function () { this.val(1); const m = this.val(1), brake = this.val(1); this.ports(m).forEach(p => Object.assign(this.b.motors[p], { running: false, power: 0, speed: 0 })); this.b.log.push('STOP ' + m.toString(16) + ' brake ' + brake); };
  H.OUTPUT_POWER = function () { this.val(1); const m = this.val(1), pw = this.val(1); this.ports(m).forEach(p => { this.b.motors[p].power = pw; }); };
  H.OUTPUT_SPEED = function () { this.val(1); const m = this.val(1), sp = this.val(1); this.ports(m).forEach(p => Object.assign(this.b.motors[p], { speed: sp, power: sp })); };
  H.OUTPUT_START = function () { this.val(1); const m = this.val(1); this.ports(m).forEach(p => { this.b.motors[p].running = true; }); };
  H.OUTPUT_POLARITY = function () { this.val(1); const m = this.val(1), pol = this.val(1); this.ports(m).forEach(p => { this.b.motors[p].polarity = pol; }); };
  H.OUTPUT_READ = function () { this.val(1); const no = this.val(1); const m = this.b.motors[no]; this.write(this.ref(), m.speed, 1); this.write(this.ref(), m.tacho, 4); };
  H.OUTPUT_TEST = function () { this.val(1); this.val(1); this.write(this.ref(), 0, 1); };
  H.OUTPUT_READY = function () { this.val(1); this.val(1); };
  H.OUTPUT_CLR_COUNT = function () { this.val(1); const m = this.val(1); this.ports(m).forEach(p => { this.b.motors[p].tacho = 0; }); };
  H.OUTPUT_GET_COUNT = function () { this.val(1); const no = this.val(1); this.write(this.ref(), this.b.motors[no].tacho, 4); };
  H.OUTPUT_PRG_STOP = function () {};
  const step = timeBased => function () {
    this.val(1); const m = this.val(1), sp = this.val(1), s1 = this.val(4), s2 = this.val(4), s3 = this.val(4); this.val(1);
    this.ports(m).forEach(p => { const mo = this.b.motors[p]; Object.assign(mo, { speed: sp, power: sp, running: false }); const deg = timeBased ? Math.trunc(sp * 3.6 * (s1 + s2 + s3) / 1000) : (s1 + s2 + s3); mo.tacho += sp >= 0 ? deg : -deg; });
    this.b.log.push((timeBased ? 'TIME ' : 'STEP ') + m.toString(16) + ' speed ' + sp + ' ' + s1 + '+' + s2 + '+' + s3);
    if (timeBased) this.pendingSleep = (s1 + s2 + s3) / 1000;
  };
  H.OUTPUT_STEP_SPEED = step(false); H.OUTPUT_STEP_POWER = step(false); H.OUTPUT_TIME_SPEED = step(true); H.OUTPUT_TIME_POWER = step(true);
  const sync = timeBased => function () {
    this.val(1); const m = this.val(1), sp = this.val(1), turn = this.val(2), st = this.val(4); this.val(1);
    this.ports(m).forEach(p => { const mo = this.b.motors[p]; Object.assign(mo, { speed: sp, power: sp, running: st === 0 }); const deg = timeBased ? Math.trunc(sp * 3.6 * st / 1000) : st; mo.tacho += sp >= 0 ? deg : -deg; });
    this.b.log.push((timeBased ? 'TIME' : 'STEP') + '_SYNC ' + m.toString(16) + ' speed ' + sp + ' turn ' + turn + ' ' + st);
    if (timeBased) this.pendingSleep = st / 1000;
  };
  H.OUTPUT_STEP_SYNC = sync(false); H.OUTPUT_TIME_SYNC = sync(true);
  H.COM_GET = function () {
    const sub = this.val(1), C = P.COM_GET;
    if (sub === C.GET_BRICKNAME) { const n = this.val(1); this.writeStr(this.ref(), this.b.name, n); }
    else if (sub === C.GET_ID) { this.val(1); const n = this.val(1); this.writeStr(this.ref(), '001653502163', n); }
    else if (sub === C.GET_ON_OFF) { this.val(1); this.write(this.ref(), 1, 1); }
    else throw new VMError('COM_GET ' + sub);
  };
  H.COM_SET = function () { const sub = this.val(1), C = P.COM_SET; if (sub === C.SET_BRICKNAME) this.b.name = this.sval().slice(0, 13); else if (sub === C.SET_ON_OFF || sub === C.SET_VISIBLE) { this.val(1); this.val(1); } else throw new VMError('COM_SET ' + sub); };
  H.INFO = function () { const sub = this.val(1), I = P.INFO; if (sub === I.GET_VOLUME) this.write(this.ref(), this.b.volume, 1); else if (sub === I.SET_VOLUME) this.b.volume = this.val(1); else if (sub === I.GET_MINUTES) this.write(this.ref(), this.b.sleepMinutes, 1); else if (sub === I.SET_MINUTES) this.b.sleepMinutes = this.val(1); else throw new VMError('INFO ' + sub); };
  H.FILE = function () {
    const sub = this.val(1), F = P.FILE;
    if (sub === F.LOAD_IMAGE) {
      this.val(2); const name = this.sval(), sizeR = this.ref(), ipR = this.ref();
      const key = name in this.b.files ? name : Object.keys(this.b.files).find(k => k.endsWith(name.replace(/^\.\.\//, '')));
      if (!key) { this.write(sizeR, 0, 4); this.write(ipR, 0, 4); throw new VMError('program not found: ' + name); }
      this.b.runningProgram = key; this.write(sizeR, this.b.files[key].length, 4); this.write(ipR, 0, 4);
    }
    else if (sub === F.MAKE_FOLDER) { this.sval(); this.write(this.ref(), 1, 1); }
    else if (sub === F.REMOVE) { const n = this.sval(); delete this.b.files[n]; }
    else throw new VMError('FILE ' + sub);
  };
  H.PROGRAM_INFO = function () { const sub = this.val(1); this.val(2); if (sub === P.PROGRAM_INFO.GET_STATUS) this.write(this.ref(), this.b.runningProgram ? 0x40 : 0x10, 1); else throw new VMError('PROGRAM_INFO ' + sub); };

  ns.vm = { VM, BrickState, VMError };
})(OpenEV3);
