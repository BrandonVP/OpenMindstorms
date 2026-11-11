/* OpenRCX - request/reply link and the high-level RCX API (browser port of
 * python/openrcx/link.py and rcx.py). */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;
  const OP = P.OP;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class NoReply extends Error { constructor(op) { super('no reply to ' + P.opcodeName(op)); this.name = 'NoReply'; this.op = op; } }
  class ReplyError extends Error {
    constructor(op, code, text) { super(text || (P.opcodeName(op) + ' failed with error ' + code)); this.name = 'ReplyError'; this.op = op; this.code = code; }
  }

  class RcxLink {
    constructor(transport, opts) {
      this.t = transport;
      this.lastOpcode = null;
      this.stats = { sent: 0, retries: 0, failed: 0 };
      this.log = (opts && opts.log) || null;      // function(dir, bytes, note)
      this.timeout = 500;
      this.downloadTimeout = 300;
      this.unlockTimeout = 2000;
      this.retries = 4;
      this.busy = false;
    }

    toggle(body) {
      let op = body[0];
      if (this.lastOpcode !== null && op === this.lastOpcode) op ^= 0x08;
      this.lastOpcode = op;
      const out = Uint8Array.from(body);
      out[0] = op;
      return out;
    }

    async send(body, opts) {
      opts = opts || {};
      if (this.busy) throw new Error('link is busy with another command');
      this.busy = true;
      try {
        body = this.toggle(Uint8Array.from(body));
        const packet = P.buildPacket(body);
        const expect = opts.expect !== undefined ? opts.expect : P.expectedReplyLength(body);
        const tries = Math.max(1, opts.retries !== undefined ? opts.retries : this.retries);
        const base = opts.timeout !== undefined ? opts.timeout : this.timeout;
        const txMs = this.t.txSeconds(packet.length) * 1000;
        for (let attempt = 0; attempt < tries; attempt++) {
          this.stats.sent++;
          if (attempt) this.stats.retries++;
          this.t.flush();
          if (this.log) this.log('tx', packet, attempt ? 'retry ' + attempt : '');
          await this.t.write(packet);
          if (P.NO_REPLY.has(body[0] & 0xF7)) { await sleep(txMs); return new Uint8Array(0); }
          const reply = await this.receive(body[0], expect, txMs + base);
          if (reply) return reply.payload;
        }
        this.stats.failed++;
        this.lastOpcode = null;
        throw new NoReply(body[0]);
      } finally {
        this.busy = false;
      }
    }

    async receive(opcode, expect, timeoutMs) {
      let deadline = Date.now() + timeoutMs;
      let seen = 0;
      for (;;) {
        const buf = this.t.rx.bytes();
        if (buf.length !== seen) {
          seen = buf.length;
          const r = P.findReply(buf, opcode, expect);
          if (r) {
            if (this.log) this.log('rx', buf.subarray(0, r.end), '');
            this.t.rx.consume(r.end);
            return r;
          }
          deadline = Math.max(deadline, Date.now() + 150);   // bytes arriving: allow the tail
        }
        if (Date.now() >= deadline) break;
        await sleep(8);
      }
      if (this.log && seen) this.log('rx', this.t.rx.bytes(), 'unmatched');
      return null;
    }

    async download(data, chunk, timeoutMs, progress) {
      const total = data.length;
      let seq = 1, pos = 0;
      while (pos < total) {
        const n = Math.min(chunk, total - pos);
        const block = data.subarray(pos, pos + n);
        if (pos + n >= total) seq = 0;
        const body = new Uint8Array(5 + n + 1);
        body.set([OP.TRANSFER_DATA, seq & 0xFF, seq >> 8, n & 0xFF, n >> 8]);
        body.set(block, 5);
        body[5 + n] = P.checksum8(block);
        const r = await this.send(body, { timeout: timeoutMs });
        if (!r.length || r[0] !== 0) {
          const code = r.length ? r[0] : -1;
          throw new ReplyError(OP.TRANSFER_DATA, code, {
            1: 'transfer failed: not enough memory', 2: 'transfer failed: invalid index',
            3: 'transfer failed: block checksum error', 4: 'transfer failed: firmware checksum error',
            6: 'transfer failed: download was not started' }[code] || ('transfer failed with error ' + code));
        }
        pos += n; seq++;
        if (progress) await progress(pos, total);
      }
    }
  }

  const motorBits = m => { let b = 0; for (const ch of String(m).toUpperCase()) b |= P.MOTOR_BITS[ch] || 0; return b; };
  const i16 = (lo, hi) => { const v = lo | (hi << 8); return v & 0x8000 ? v - 0x10000 : v; };

  class RCX {
    constructor(link) { this.link = link; }

    async ping() { await this.link.send([OP.ALIVE]); return true; }

    async versions() {
      const r = await this.link.send([OP.GET_VERSIONS, ...P.VERSIONS_KEY]);
      const rom = ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0;
      const fw = ((r[4] << 24) | (r[5] << 16) | (r[6] << 8) | r[7]) >>> 0;
      const fmt = v => { const lo = v & 0xFFFF; return (v >>> 16).toString(16) + '.' + lo.toString(16).padStart(lo > 0xFF ? 4 : 2, '0'); };
      const known = { 0x00030208: 'firm0328 (RIS 2.0)' };   // as reported by a real brick
      return { rom, firmware: fw, hasFirmware: fw !== 0, romText: fmt(rom),
        firmwareText: fw ? fmt(fw) + (known[fw] ? ' = ' + known[fw] : '') : 'none',
        raw: rom.toString(16).padStart(8, '0') + '/' + fw.toString(16).padStart(8, '0') };
    }

    async batteryMv() { const r = await this.link.send([OP.GET_BATTERY]); return r[0] | (r[1] << 8); }
    async powerOff() { await this.link.send([OP.POWER_OFF]); }
    async setPowerDownDelay(min) { await this.link.send([OP.SET_POWER_DOWN_DELAY, min & 0xFF]); }
    async setTxRange(long) { await this.link.send([OP.SET_TX_RANGE, long ? 1 : 0]); }
    async setTime(h, m) { await this.link.send([OP.SET_TIME, h % 24, m % 60]); }

    async playSound(n) { await this.link.send([OP.PLAY_SOUND, n & 7]); }
    async playTone(hz, cs) { await this.link.send([OP.PLAY_TONE, hz & 0xFF, (hz >> 8) & 0xFF, Math.max(1, Math.min(255, cs))]); }

    async motorOn(m) { await this.link.send([OP.SET_MOTOR_ON_OFF, motorBits(m) | 0x80]); }
    async motorOff(m) { await this.link.send([OP.SET_MOTOR_ON_OFF, motorBits(m) | 0x40]); }
    async motorFloat(m) { await this.link.send([OP.SET_MOTOR_ON_OFF, motorBits(m)]); }
    async motorDirection(m, dir) {
      const code = { fwd: 0x80, rev: 0x00, flip: 0x40 }[dir];
      await this.link.send([OP.SET_MOTOR_DIR, motorBits(m) | code]);
    }
    async motorPower(m, p) { await this.link.send([OP.SET_MOTOR_POWER, motorBits(m), P.SRC.CONSTANT, Math.max(0, Math.min(7, p))]); }

    async setSensorType(s, t) { await this.link.send([OP.SET_SENSOR_TYPE, s & 3, t & 0xFF]); }
    async setSensorMode(s, mode, slope) { await this.link.send([OP.SET_SENSOR_MODE, s & 3, ((mode & 7) << 5) | ((slope || 0) & 0x1F)]); }
    async clearSensor(s) { await this.link.send([OP.CLEAR_SENSOR, s & 3]); }

    async getValue(src, idx) { const r = await this.link.send([OP.GET_VALUE, src & 0xFF, idx & 0xFF]); return i16(r[0], r[1]); }
    sensorValue(s) { return this.getValue(P.SRC.SENSOR_VALUE, s); }
    sensorRaw(s) { return this.getValue(P.SRC.SENSOR_RAW, s); }
    variable(i) { return this.getValue(P.SRC.VARIABLE, i); }
    async setVariable(i, v) { await this.link.send([OP.SET_VARIABLE, i & 0x1F, P.SRC.CONSTANT, v & 0xFF, (v >> 8) & 0xFF]); }
    currentProgram() { return this.getValue(P.SRC.PROGRAM, 0); }
    watch() { return this.getValue(P.SRC.WATCH, 0); }
    message() { return this.getValue(P.SRC.MESSAGE, 0); }
    async setMessage(v) { await this.link.send([OP.SET_MESSAGE, v & 0xFF]); }
    async clearTimer(i) { await this.link.send([OP.CLEAR_TIMER, i & 3]); }

    async setDisplay(what) { await this.link.send([OP.SET_DISPLAY, P.SRC.CONSTANT, what & 0xFF, 0]); }
    async selectProgram(n) { await this.link.send([OP.SET_PROGRAM, n & 7]); }
    async startTask(t) { await this.link.send([OP.START_TASK, (t || 0) & 0x0F]); }
    async stopTask(t) { await this.link.send([OP.STOP_TASK, t & 0x0F]); }
    async stopAll() { await this.link.send([OP.STOP_ALL_TASKS]); }
    async deleteAllTasks() { await this.link.send([OP.DELETE_ALL_TASKS]); }
    async deleteAllSubs() { await this.link.send([OP.DELETE_ALL_SUBS]); }

    async memoryMap() {
      const r = await this.link.send([OP.GET_MEMORY_MAP]);
      const words = [];
      for (let i = 0; i < 94; i++) words.push((r[2 * i] << 8) | r[2 * i + 1]);
      return words;
    }
    async setDatalogSize(n) {
      const r = await this.link.send([OP.SET_DATALOG_SIZE, n & 0xFF, n >> 8]);
      if (r.length && r[0] !== 0) throw new ReplyError(OP.SET_DATALOG_SIZE, r[0], 'not enough memory for a datalog of ' + n);
    }
    async uploadDatalog() {
      const head = await this.link.send([OP.UPLOAD_DATALOG, 0, 0, 1, 0]);
      const size = i16(head[1], head[2]);
      const count = Math.max(0, size - 1);
      if (!count) return [];
      const r = await this.link.send([OP.UPLOAD_DATALOG, 1, 0, count & 0xFF, count >> 8]);
      const rows = [];
      for (let i = 0; i + 2 < r.length; i += 3) rows.push({ kind: r[i], value: i16(r[i + 1], r[i + 2]) });
      return rows;
    }

    raw(body, expect) { return this.link.send(body, { expect }); }

    async downloadFirmware(img, progress) {
      await this.ping();
      await this.link.send([OP.DELETE_FIRMWARE, ...P.VERSIONS_KEY]);
      const r = await this.link.send([OP.BEGIN_FIRMWARE, img.start & 0xFF, img.start >> 8, img.checksum & 0xFF, img.checksum >> 8, 0]);
      if (r.length && r[0] !== 0) throw new ReplyError(OP.BEGIN_FIRMWARE, r[0], 'BeginFirmware refused (error ' + r[0] + ')');
      await this.link.download(img.data, 200, this.link.downloadTimeout, progress);
      const reply = await this.link.send([OP.UNLOCK_FIRMWARE, ...P.UNLOCK_KEY], { timeout: this.link.unlockTimeout, retries: 1 });
      const text = String.fromCharCode(...reply);
      if (text !== P.UNLOCK_REPLY) throw new Error('unexpected unlock reply: ' + JSON.stringify(text));
    }

    async deleteFirmware() { await this.ping(); await this.link.send([OP.DELETE_FIRMWARE, ...P.VERSIONS_KEY]); }

    async downloadProgram(img, program, progress, beep) {
      await this.ping();
      await this.stopAll();
      await this.selectProgram(program);
      await this.deleteAllTasks();
      await this.deleteAllSubs();
      const total = img.size;
      let done = 0;
      for (const c of img.chunks) {
        const op = c.type === 0 ? OP.BEGIN_TASK : OP.BEGIN_SUB;
        const n = c.data.length;
        const r = await this.link.send([op, 0, c.number, 0, n & 0xFF, n >> 8]);
        if (!r.length || r[0] !== 0) {
          const code = r.length ? r[0] : -1;
          throw new ReplyError(op, code, 'cannot start ' + (c.type === 0 ? 'task ' : 'sub ') + c.number + ' download: ' + ({ 1: 'not enough memory', 2: 'invalid task/sub number' }[code] || ('error ' + code)));
        }
        const base = done;
        await this.link.download(c.data, 20, this.link.downloadTimeout, progress ? (p => progress(base + p, total)) : null);
        done += n;
      }
      if (beep !== false) await this.playSound(5);
    }
  }

  ns.link = { RcxLink, RCX, NoReply, ReplyError, sleep };
})(OpenRCX);
