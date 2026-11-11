/* OpenNXT - a software NXT (port of python/opennxt/sim.py). */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
(function (ns) {
  'use strict';
  const P = ns.protocol, C = P.CMD;
  const enc = new TextEncoder();

  class SimNXT {
    constructor() {
      this.name = 'NXT'; this.btAddress = [0x00, 0x16, 0x53, 0x02, 0xC8, 0xE0];
      this.firmware = [1, 31]; this.protocol = [1, 124]; this.batteryMv = 8000; this.freeFlash = 100000; this.sleepMs = 600000;
      this.files = { 'Untitled-1.rxe': new Uint8Array(300), 'Woops.rso': new Uint8Array(1500) };
      this.handles = {}; this.nextHandle = 0; this.running = null;
      this.motors = [0, 1, 2].map(() => ({ power: 0, mode: 0, reg: 0, turn: 0, run: 0, limit: 0, tacho: 0, block: 0, rot: 0 }));
      this.sensors = [0, 1, 2, 3].map(() => ({ type: 0, mode: 0, raw: 1023, scaled: 0 }));
      this.ultrasonicCm = [40, 40, 40, 40]; this.lsReply = [[], [], [], []];
      this.mailboxes = Array.from({ length: 20 }, () => []);
      this.sounds = []; this.log = []; this.onChange = null;
    }
    handle(msg) {
      const type = msg[0], cmd = msg[1], a = msg.subarray(2);
      this.log.push({ cmd, args: Uint8Array.from(a) });
      const fn = this['c' + cmd.toString(16).padStart(2, '0')];
      let status = 0xBE, data = [];
      if (fn) { const r = fn.call(this, a); if (Array.isArray(r) && typeof r[0] === 'number' && r.length === 2 && (Array.isArray(r[1]) || r[1] instanceof Uint8Array)) { status = r[0]; data = r[1]; } else { status = 0; data = r || []; } }
      if (this.onChange) this.onChange(this);
      if (type & 0x80) return null;
      return Uint8Array.from([P.T.REPLY, cmd, status, ...data]);
    }
    h() { this.nextHandle = (this.nextHandle + 1) & 0xFF; return this.nextHandle; }

    c00(a) { const n = P.cstr(a.subarray(0, 20)); if (!(n in this.files)) return [0xBD, []]; this.running = n; return []; }
    c01() { if (!this.running) return [0xEC, []]; this.running = null; return []; }
    c02(a) { const n = P.cstr(a.subarray(1, 21)); if (!(n in this.files)) return [0xBD, []]; this.sounds.push(n); return []; }
    c03(a) { this.sounds.push({ hz: P.rdU16(a, 0), ms: P.rdU16(a, 2) }); return []; }
    c04(a) {
      const port = a[0], power = P.rdI8(a[1]), mode = a[2], reg = a[3], turn = P.rdI8(a[4]), run = a[5], limit = P.rdU32(a, 6);
      if (port !== P.PORT_ALL && port > 2) return [0xF0, []];
      for (const p of (port === P.PORT_ALL ? [0, 1, 2] : [port])) {
        const m = this.motors[p]; Object.assign(m, { power, mode, reg, turn, run, limit });
        if ((mode & P.MOTOR.ON) && run !== P.RUN.IDLE && power) { let d = limit || 360; if (power < 0) d = -d; m.tacho += d; m.block += d; m.rot += d; if (limit) m.run = P.RUN.IDLE; }
      }
      return [];
    }
    c05(a) { if (a[0] > 3) return [0xF0, []]; Object.assign(this.sensors[a[0]], { type: a[1], mode: a[2] }); return []; }
    c06(a) { const p = a[0]; if (p > 2) return [0xF0, []]; const m = this.motors[p];
      return [p, P.s8(m.power), m.mode, m.reg, P.s8(m.turn), m.run, ...P.u32(m.limit), ...P.u32(m.tacho >>> 0), ...P.u32(m.block >>> 0), ...P.u32(m.rot >>> 0)]; }
    c07(a) { const p = a[0]; if (p > 3) return [0xF0, []]; const s = this.sensors[p];
      return [p, 1, 0, s.type, s.mode, ...P.u16(s.raw), ...P.u16(s.raw), ...P.u16(s.scaled & 0xFFFF), ...P.u16(s.scaled & 0xFFFF)]; }
    c08(a) { this.sensors[a[0]].scaled = 0; return []; }
    c09(a) { this.mailboxes[a[0]].push(Uint8Array.from(a.subarray(2, 2 + a[1]))); return []; }
    c0a(a) { const m = this.motors[a[0]]; if (a[1]) m.block = 0; else { m.tacho = 0; m.block = 0; m.rot = 0; } return []; }
    c0b() { return P.u16(this.batteryMv); }
    c0c() { return []; }
    c0d() { return P.u32(this.sleepMs); }
    c0e(a) { return [this.lsReply[a[0]].length]; }
    c0f(a) { const port = a[0], tx = Array.from(a.subarray(3, 3 + a[1])); this.lsReply[port] = (tx[0] === 0x02 && tx[1] === 0x42) ? [this.ultrasonicCm[port]] : new Array(a[2]).fill(0); return []; }
    c10(a) { const d = this.lsReply[a[0]]; this.lsReply[a[0]] = []; return [d.length, ...d, ...new Array(16 - d.length).fill(0)]; }
    c11() { if (!this.running) return [0xEC, []]; return Array.from(P.name20(this.running)); }
    c13(a) { const local = a[1], box = this.mailboxes[local]; if (!box.length) return [0x40, [local, 0, ...new Array(59).fill(0)]];
      let m = Array.from(a[2] ? box.shift() : box[0]).slice(0, 58); if (m[m.length - 1] !== 0) m.push(0); return [local, m.length, ...m, ...new Array(59 - m.length).fill(0)]; }

    c80(a) { const n = P.cstr(a.subarray(0, 20)); if (!(n in this.files)) return [0x87, [0, 0, 0, 0, 0]]; const h = this.h(); this.handles[h] = { name: n, pos: 0, mode: 'r' }; return [h, ...P.u32(this.files[n].length)]; }
    openWrite(a) { const n = P.cstr(a.subarray(0, 20)), size = P.rdU32(a, 20); if (n in this.files) return [0x8F, [0]]; if (size > this.freeFlash) return [0x82, [0]];
      const h = this.h(); this.handles[h] = { name: n, data: [], size, mode: 'w' }; return [h]; }
    c81(a) { return this.openWrite(a); } c89(a) { return this.openWrite(a); } c8b(a) { return this.openWrite(a); }
    c82(a) { const h = a[0], n = P.rdU16(a, 1), f = this.handles[h]; if (!f || f.mode !== 'r') return [0x93, [h, 0, 0]];
      const d = Array.from(this.files[f.name].subarray(f.pos, f.pos + n)); f.pos += d.length; return [h, ...P.u16(d.length), ...d]; }
    c83(a) { const h = a[0], f = this.handles[h]; if (!f || f.mode !== 'w') return [0x93, [h, 0, 0]]; const chunk = Array.from(a.subarray(1));
      if (f.data.length + chunk.length > f.size) return [0x8E, [h, 0, 0]]; f.data.push(...chunk); return [h, ...P.u16(chunk.length)]; }
    c84(a) { const h = a[0], f = this.handles[h]; if (!f) return [0x88, [h]]; delete this.handles[h]; if (f.mode === 'w') { this.files[f.name] = Uint8Array.from(f.data); this.freeFlash -= f.data.length; } return [h]; }
    c85(a) { const n = P.cstr(a.subarray(0, 20)); if (!(n in this.files)) return [0x87, Array.from(P.name20(n))]; this.freeFlash += this.files[n].length; delete this.files[n]; return Array.from(P.name20(n)); }
    match(pattern, name) { const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); return re.test(name); }
    c86(a) { const pattern = P.cstr(a.subarray(0, 20)) || '*.*'; const names = Object.keys(this.files).sort().filter(n => this.match(pattern, n));
      if (!names.length) return [0x87, new Array(25).fill(0)]; const h = this.h(); this.handles[h] = { mode: 'find', names, i: 0 }; return [h, ...P.name20(names[0]), ...P.u32(this.files[names[0]].length)]; }
    c87(a) { const h = a[0], f = this.handles[h]; if (!f || f.mode !== 'find') return [0x93, [h, ...new Array(24).fill(0)]]; f.i++;
      if (f.i >= f.names.length) return [0x83, [h, ...new Array(24).fill(0)]]; const n = f.names[f.i]; return [h, ...P.name20(n), ...P.u32(this.files[n].length)]; }
    c88() { return [this.protocol[1], this.protocol[0], this.firmware[1], this.firmware[0]]; }
    c97() { return []; }
    c98(a) { this.name = P.cstr(a.subarray(0, 16)); return []; }
    c9b() { const n = Array.from(enc.encode(this.name).subarray(0, 15)); while (n.length < 15) n.push(0); return [...n, ...this.btAddress, 0, ...P.u32(200), ...P.u32(this.freeFlash)]; }
    ca0() { this.files = {}; this.freeFlash = 100000; return []; }
  }

  class SimTransport {
    constructor(opts) { this.name = 'Simulator'; this.nxt = new SimNXT(); this.queue = []; this.txLog = []; this.label = 'simulated brick'; this.latency = (opts && opts.latency) || 0; }
    static available() { return true; }
    async open() { return this; }
    async send(msg) { this.txLog.push(Uint8Array.from(msg)); const r = this.nxt.handle(Uint8Array.from(msg)); if (r) this.queue.push(r); }
    async recv() { if (this.latency) await new Promise(r => setTimeout(r, this.latency)); return this.queue.length ? this.queue.shift() : null; }
    async flush() { this.queue = []; }
    async close() {}
  }

  ns.sim = { SimNXT, SimTransport };
})(OpenNXT);
