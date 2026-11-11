/* OpenRCX - a software RCX (port of python/openrcx/sim.py) so the GUI can be
 * explored and tested with no hardware. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;
  const OP = P.OP;
  const ROM_VERSION = 0x00030001;
  const FW_0328 = 0x00030208;   // what a real brick reports after firm0328.lgo
  // Observed on a real RCX 2.0 ROM: other opcodes just get the previous reply again.
  const ROM_OPS = new Set([OP.ALIVE, OP.GET_VERSIONS, OP.DELETE_FIRMWARE,
    OP.BEGIN_FIRMWARE, OP.TRANSFER_DATA, OP.UNLOCK_FIRMWARE, OP.POWER_OFF]);
  const u16 = (lo, hi) => lo | (hi << 8);
  const le16 = v => [v & 0xFF, (v >> 8) & 0xFF];

  class SimRCX {
    constructor(opts) {
      opts = opts || {};
      this.firmwareVersion = opts.firmware === false ? 0 : FW_0328;
      this.batteryMv = opts.batteryMv || 8700;
      this.lastOp = null; this.lastReply = null; this.log = [];
      this.fwStart = null; this.fwChecksum = 0; this.fwBuf = []; this.fwNextSeq = 0; this.fwComplete = false;
      this.programs = [{}, {}, {}, {}, {}]; this.program = 0;
      this.dlTarget = null; this.dlBuf = []; this.dlNextSeq = 0;
      this.variables = new Array(32).fill(0); this.timers = [0, 0, 0, 0];
      this.sensorType = [0, 0, 0]; this.sensorMode = [0, 0, 0]; this.sensorValues = [0, 0, 0];
      this.motors = [0x4F, 0x4F, 0x4F]; this.message = 0; this.watch = 0;   // off, power 7, fwd
      this.running = new Set(); this.sounds = []; this.display = 0; this.poweredOff = false;
      this.datalog = []; this.datalogSize = 0;
      this.onChange = opts.onChange || null;
    }

    handle(body) {
      const op = body[0];
      if (op === this.lastOp) return this.lastReply;
      this.lastOp = op;
      const base = op & 0xF7;
      const a = body.subarray(1);
      this.log.push({ op: base, args: Uint8Array.from(a) });
      if (this.firmwareVersion === 0 && !ROM_OPS.has(base)) return this.lastReply;
      const h = this['op' + base.toString(16).padStart(2, '0')];
      const reply = h ? h.call(this, a) : [];
      if (this.onChange) this.onChange(this);
      if (reply === null) { this.lastReply = null; return null; }
      this.lastReply = Uint8Array.from([(~op) & 0xFF, ...reply]);
      return this.lastReply;
    }

    op10() { return []; }
    op15(a) { if (!P.VERSIONS_KEY.every((v, i) => a[i] === v)) return null;
      const be = v => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
      return [...be(ROM_VERSION), ...be(this.firmwareVersion)]; }
    op30() { return le16(this.batteryMv); }
    op60() { this.poweredOff = true; return []; }
    op65(a) { if (!P.VERSIONS_KEY.every((v, i) => a[i] === v)) return null;
      this.firmwareVersion = 0; this.fwComplete = false; this.fwStart = null; return []; }
    op75(a) { if (this.firmwareVersion || a.length !== 5) return null;
      this.fwStart = u16(a[0], a[1]); this.fwChecksum = u16(a[2], a[3]); this.fwBuf = []; this.fwNextSeq = 1;
      this.fwComplete = false; this.dlTarget = null; return [0]; }
    op45(a) {
      if (a.length < 5) return null;
      const seq = u16(a[0], a[1]), length = u16(a[2], a[3]);
      const data = Array.from(a.subarray(4, 4 + length));
      if (a.length !== 4 + length + 1) return [3];
      if (seq !== 0 && a[4 + length] !== P.checksum8(data)) return [3];
      if (this.fwStart !== null && !this.fwComplete && this.firmwareVersion === 0) {
        if (seq !== 0 && seq !== this.fwNextSeq) return null;
        this.fwBuf.push(...data); this.fwNextSeq++;
        if (seq === 0) {
          let got = 0; for (let i = 0; i < Math.min(this.fwBuf.length, 0x4C00); i++) got = (got + this.fwBuf[i]) & 0xFFFF;
          if (got !== this.fwChecksum) return [4];
          this.fwComplete = true;
        }
        return [0];
      }
      if (this.dlTarget) {
        if (seq !== 0 && seq !== this.dlNextSeq) return null;
        this.dlBuf.push(...data); this.dlNextSeq++;
        if (seq === 0) { this.programs[this.program][this.dlTarget.type + ':' + this.dlTarget.number] = Uint8Array.from(this.dlBuf); this.dlTarget = null; }
        return [0];
      }
      return [6];
    }
    opa5(a) { if (!P.UNLOCK_KEY.every((v, i) => a[i] === v)) return null;
      const txt = Array.from(P.UNLOCK_REPLY, c => c.charCodeAt(0));
      if (this.fwComplete && this.firmwareVersion === 0) { this.firmwareVersion = FW_0328; this.fwComplete = false; return txt; }
      return this.firmwareVersion ? txt : null; }
    op51(a) { this.sounds.push(a[0]); return []; }
    op23(a) { this.sounds.push({ tone: u16(a[0], a[1]), cs: a[2] }); return []; }
    op21(a) { for (let i = 0; i < 3; i++) if (a[0] & (1 << i)) this.motors[i] = (this.motors[i] & 0x0F) | (a[0] & 0xC0); return []; }
    ope1(a) { for (let i = 0; i < 3; i++) if (a[0] & (1 << i)) {   // status bit 3 set = forward
      if (a[0] & 0x40) this.motors[i] ^= 0x08; else if (a[0] & 0x80) this.motors[i] |= 0x08; else this.motors[i] &= ~0x08; } return []; }
    op13(a) { for (let i = 0; i < 3; i++) if (a[0] & (1 << i)) this.motors[i] = (this.motors[i] & 0xF8) | (a[2] & 7); return []; }
    op32(a) { if (a[0] < 3) this.sensorType[a[0]] = a[1]; return []; }
    op42(a) { if (a[0] < 3) this.sensorMode[a[0]] = a[1]; return []; }
    opd1(a) { if (a[0] < 3) this.sensorValues[a[0]] = 0; return []; }
    op14(a) { if (a[1] === P.SRC.CONSTANT && a[0] < 32) { const v = u16(a[2], a[3]); this.variables[a[0]] = v & 0x8000 ? v - 0x10000 : v; } return []; }
    op12(a) {
      const src = a[0], idx = a[1]; let v = 0;
      switch (src) {
        case P.SRC.VARIABLE: v = this.variables[idx & 31]; break;
        case P.SRC.TIMER: v = this.timers[idx & 3]; break;
        case P.SRC.MOTOR_STATUS: v = this.motors[idx % 3]; break;
        case P.SRC.PROGRAM: v = this.program; break;
        case P.SRC.SENSOR_VALUE: case P.SRC.SENSOR_RAW: v = this.sensorValues[idx % 3]; break;
        case P.SRC.SENSOR_BOOL: v = this.sensorValues[idx % 3] ? 1 : 0; break;
        case P.SRC.SENSOR_TYPE: v = this.sensorType[idx % 3]; break;
        case P.SRC.SENSOR_MODE: v = this.sensorMode[idx % 3]; break;
        case P.SRC.WATCH: v = this.watch; break;
        case P.SRC.MESSAGE: v = this.message; break;
        default: return null;
      }
      return le16(v & 0xFFFF);
    }
    op33(a) { this.display = a[1]; return []; }
    op22(a) { this.watch = a[0] * 60 + a[1]; return []; }
    op91(a) { this.program = a[0] % 5; this.running.clear(); return []; }
    op40() { const p = this.programs[this.program]; for (const k of Object.keys(p)) if (k[0] === '0') delete p[k]; return []; }
    op70() { const p = this.programs[this.program]; for (const k of Object.keys(p)) if (k[0] === '1') delete p[k]; return []; }
    begin(type, a) {
      const number = u16(a[1], a[2]), length = u16(a[3], a[4]);
      if (number >= (type === 0 ? 10 : 8)) return [2];
      let used = 0; for (const d of Object.values(this.programs[this.program])) used += d.length;
      if (used + length > 6000) return [1];
      this.dlTarget = { type, number, length }; this.dlBuf = []; this.dlNextSeq = 1; return [0];
    }
    op25(a) { return this.begin(0, a); }
    op35(a) { return this.begin(1, a); }
    op71(a) { this.running.add(a[0]); return []; }
    op81(a) { this.running.delete(a[0]); return []; }
    op50() { this.running.clear(); return []; }
    op61(a) { delete this.programs[this.program]['0:' + a[0]]; return []; }
    opc1(a) { delete this.programs[this.program]['1:' + a[0]]; return []; }
    op20() { const w = new Array(94).fill(0); w[92] = 0x9000; w[93] = 0xFFFF;
      const out = []; for (const v of w) out.push(v >> 8, v & 0xFF); return out; }
    op52(a) { this.datalogSize = u16(a[0], a[1]); this.datalog = []; return [0]; }
    opa4(a) { const first = u16(a[0], a[1]), count = u16(a[2], a[3]);
      const entries = [{ kind: 0xFF, value: this.datalog.length + 1 }, ...this.datalog];
      const out = []; for (let i = first; i < first + count; i++) { const e = entries[i] || { kind: 0, value: 0 }; out.push(e.kind, ...le16(e.value & 0xFFFF)); } return out; }
    opf7(a) { this.message = a[0]; return null; }
    opb1() { return []; }
    op31() { return []; }
    opa1(a) { this.timers[a[0] & 3] = 0; return []; }
  }

  /* Transport that wraps a SimRCX. */
  class SimTransport {
    constructor(opts) {
      opts = opts || {};
      this.name = 'Simulated RCX';
      this.echoes = !!opts.echoes;
      this.rcx = new SimRCX(opts);
      this.rx = new ns.transports.RxBuffer();
      this.dropReplies = opts.dropReplies || 0;
      this.latency = opts.latency || 0;        // ms before the reply appears
      this.txLog = [];
      this.portLabel = 'simulator';
    }
    static available() { return true; }
    async open() { return this; }
    async write(bytes) {
      this.txLog.push(Uint8Array.from(bytes));
      if (this.echoes) this.rx.push(Uint8Array.from(bytes));
      const body = P.parseCommand(bytes);
      if (!body) return;
      const reply = this.rcx.handle(body);
      if (!reply) return;
      if (this.dropReplies > 0) { this.dropReplies--; return; }
      const pkt = P.buildPacket(reply);
      if (this.latency) setTimeout(() => this.rx.push(pkt), this.latency); else this.rx.push(pkt);
    }
    flush() { this.rx.clear(); }
    txSeconds() { return 0; }
    async close() {}
  }

  ns.sim = { SimRCX, SimTransport };
})(OpenRCX);
