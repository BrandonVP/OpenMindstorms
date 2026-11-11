/* OpenEV3 - brick API (port of python/openev3/brick.py). */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol, T = P.T;
  const { LC, LC0, LC1, LC2, LC4, LCS, GV, op } = P;
  const PRJS = '../prjs/';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fix = p => (p.startsWith('../') || p.startsWith('/')) ? p : PRJS + p;

  class EV3Error extends Error { constructor(m) { super(m); this.name = 'EV3Error'; } }

  class EV3 {
    constructor(transport, opts) {
      this.t = transport; this.log = (opts && opts.log) || null; this.timeout = 2000; this.counter = 0;
      this.stats = { sent: 0, errors: 0 }; this.busy = false;
    }
    async exchange(msg, reply, timeoutMs) {
      this.stats.sent++;
      if (this.log) this.log('tx', msg, '');
      await this.t.send(msg);
      if (reply === false) return null;
      const deadline = Date.now() + (timeoutMs || this.timeout);
      for (;;) {
        const data = await this.t.recv(Math.max(10, deadline - Date.now()));
        if (!data) { this.stats.errors++; throw new EV3Error('no reply from the EV3 (is it on and connected?)'); }
        if (this.log) this.log('rx', data.subarray(0, Math.min(data.length, 64)), data.length > 64 ? '…' : '');
        const m = P.parseMessage(data);
        if (m.counter === this.counter) return m;
        if (Date.now() >= deadline) { this.stats.errors++; throw new EV3Error('reply counter mismatch'); }
      }
    }
    async direct(bytecodes, globals, locals, reply, timeoutMs) {
      this.counter = (this.counter + 1) & 0xFFFF;
      const msg = P.directCommand(bytecodes, globals || 0, locals || 0, this.counter, reply);
      const m = await this.exchange(msg, reply, timeoutMs);
      if (!m) return new Uint8Array(0);
      if (m.type === T.REPLY_DIRECT_ERROR) { this.stats.errors++; throw new EV3Error('the brick reported an error running the command'); }
      return m.rest;
    }
    async system(command, payload, ok, reply, timeoutMs) {
      ok = ok || [0];
      this.counter = (this.counter + 1) & 0xFFFF;
      const msg = P.systemCommand(command, payload || [], this.counter, reply);
      const m = await this.exchange(msg, reply, timeoutMs);
      if (!m) return { status: 0, data: new Uint8Array(0) };
      const status = m.rest[1];
      if (!ok.includes(status)) { this.stats.errors++; throw new EV3Error('system command 0x' + command.toString(16) + ' failed: ' + (P.SYSTEM_STATUS[status] || status)); }
      return { status, data: m.rest.subarray(2) };
    }

    // -- identity
    async info() {
      const g = await this.direct([...op('UI_READ', LC0(P.UI_READ.GET_FW_VERS), LC0(16), GV(0)), ...op('UI_READ', LC0(P.UI_READ.GET_VBATT), GV(16)),
        ...op('UI_READ', LC0(P.UI_READ.GET_LBATT), GV(20)), ...op('UI_READ', LC0(P.UI_READ.GET_OS_VERS), LC0(16), GV(21)),
        ...op('UI_READ', LC0(P.UI_READ.GET_HW_VERS), LC0(8), GV(37)), ...op('COM_GET', LC0(P.COM_GET.GET_BRICKNAME), LC0(16), GV(45))], 61);
      return { name: P.cstr(g.subarray(45, 61)), firmware: P.cstr(g.subarray(0, 16)), hardware: P.cstr(g.subarray(37, 45)), os: P.cstr(g.subarray(21, 37)),
        batteryV: P.rdF(g, 16), batteryPct: g[20] };
    }
    async battery() { const g = await this.direct([...op('UI_READ', LC0(P.UI_READ.GET_VBATT), GV(0)), ...op('UI_READ', LC0(P.UI_READ.GET_LBATT), GV(4))], 5); return { volts: P.rdF(g, 0), pct: g[4] }; }
    async name() { return P.cstr(await this.direct(op('COM_GET', LC0(P.COM_GET.GET_BRICKNAME), LC0(16), GV(0)), 16)); }
    async setName(n) { await this.direct(op('COM_SET', LC0(P.COM_SET.SET_BRICKNAME), LCS(String(n).slice(0, 13)))); }
    async volume() { return (await this.direct(op('INFO', LC0(P.INFO.GET_VOLUME), GV(0)), 1))[0]; }
    async setVolume(pct) { await this.direct(op('INFO', LC0(P.INFO.SET_VOLUME), LC1(Math.max(0, Math.min(100, pct))))); }
    async sleepMinutes() { return (await this.direct(op('INFO', LC0(P.INFO.GET_MINUTES), GV(0)), 1))[0]; }
    async setSleepMinutes(m) { await this.direct(op('INFO', LC0(P.INFO.SET_MINUTES), LC1(m))); }

    // -- sound, LED, display, buttons
    async playTone(hz, ms, volume, reply) { await this.direct(op('SOUND', LC0(P.SOUND.TONE), LC1(volume == null ? 50 : volume), LC2(hz), LC2(ms)), 0, 0, reply === true); }
    async playFile(name, volume, repeat) { await this.direct(op('SOUND', LC0(repeat ? P.SOUND.REPEAT : P.SOUND.PLAY), LC1(volume == null ? 50 : volume), LCS(name)), 0, 0, false); }
    async stopSound() { await this.direct(op('SOUND', LC0(P.SOUND.BREAK)), 0, 0, false); }
    async led(pattern) { if (typeof pattern === 'string') pattern = P.LED_PATTERNS[pattern.toLowerCase().replace(/-/g, '_')]; await this.direct(op('UI_WRITE', LC0(P.UI_WRITE.LED), LC0(pattern)), 0, 0, false); }
    async displayText(lines, font, clear) {
      if (typeof lines === 'string') lines = lines.split('\n');
      font = font == null ? 1 : font;
      const step = { 0: 9, 1: 12, 2: 18 }[font];
      let bc = [];
      if (clear !== false) bc.push(...op('UI_DRAW', LC0(P.UI_DRAW.FILLWINDOW), LC0(0), LC0(0), LC0(0)));
      bc.push(...op('UI_DRAW', LC0(P.UI_DRAW.SELECT_FONT), LC0(font)));
      lines.slice(0, 12).forEach((line, i) => { bc.push(...op('UI_DRAW', LC0(P.UI_DRAW.TEXT), LC0(1), LC(2), LC(2 + i * step), LCS(String(line).slice(0, 30)))); });
      bc.push(...op('UI_DRAW', LC0(P.UI_DRAW.UPDATE)));
      await this.direct(bc, 0, 0, false);
    }
    async displayClear() { await this.direct([...op('UI_DRAW', LC0(P.UI_DRAW.FILLWINDOW), LC0(0), LC0(0), LC0(0)), ...op('UI_DRAW', LC0(P.UI_DRAW.UPDATE))], 0, 0, false); }
    async buttons() {
      const names = ['up', 'enter', 'down', 'right', 'left', 'back'];
      const bc = [].concat(...names.map((n, i) => op('UI_BUTTON', LC0(P.UI_BUTTON.PRESSED), LC0(P.BUTTONS[n]), GV(i))));
      const g = await this.direct(bc, names.length);
      const out = {}; names.forEach((n, i) => { out[n] = !!g[i]; }); return out;
    }

    // -- devices
    async devices() {
      const nos = [0, 1, 2, 3, 16, 17, 18, 19], labels = ['1', '2', '3', '4', 'A', 'B', 'C', 'D'];
      const bc = [].concat(...nos.map((no, i) => op('INPUT_DEVICE', LC0(P.INPUT_DEVICE.GET_TYPEMODE), LC0(0), LC0(no), GV(i * 2), GV(i * 2 + 1))));
      const g = await this.direct(bc, 16);
      return nos.map((no, i) => { const type = g[i * 2]; return { port: labels[i], no, type, mode: g[i * 2 + 1], typeName: P.DEVICE_TYPES[type] || ('type ' + type), present: ![125, 126, 127].includes(type), modes: P.SENSOR_MODES[type] || {} }; });
    }
    static no(port) { const s = String(port).toUpperCase(); if ('ABCD'.includes(s) && s) return 16 + 'ABCD'.indexOf(s); const n = Number(s); if (n >= 1 && n <= 4) return n - 1; throw new Error('port must be 1..4 or A..D'); }
    async sensorRead(port, mode, values) {
      values = values || 1; const no = EV3.no(port); const m = (mode == null) ? -1 : mode;
      const bc = op('INPUT_DEVICE', LC0(P.INPUT_DEVICE.READY_SI), LC0(0), LC(no), LC0(0), LC0(m), LC0(values), ...Array.from({ length: values }, (_, i) => GV(i * 4)));
      const g = await this.direct(bc, values * 4, 0, true, 5000);
      return Array.from({ length: values }, (_, i) => P.rdF(g, i * 4));
    }
    async sensorValue(port, mode) { return (await this.sensorRead(port, mode, 1))[0]; }

    // -- motors
    async motorPower(ports, power, reply) { const m = P.portMask(ports); await this.direct([...op('OUTPUT_POWER', LC0(0), LC0(m), LC(power)), ...op('OUTPUT_START', LC0(0), LC0(m))], 0, 0, reply === true); }
    async motorSpeed(ports, speed, reply) { const m = P.portMask(ports); await this.direct([...op('OUTPUT_SPEED', LC0(0), LC0(m), LC(speed)), ...op('OUTPUT_START', LC0(0), LC0(m))], 0, 0, reply === true); }
    async motorStop(ports, brake, reply) { await this.direct(op('OUTPUT_STOP', LC0(0), LC0(P.portMask(ports || 'ABCD')), LC0(brake === false ? 0 : 1)), 0, 0, reply === true); }
    async motorDegrees(ports, speed, degrees, brake, wait) {
      const m = P.portMask(ports); const sp = degrees < 0 ? -speed : speed;
      let bc = op('OUTPUT_STEP_SPEED', LC0(0), LC0(m), LC(sp), LC(0), LC(Math.abs(degrees)), LC(0), LC0(brake === false ? 0 : 1));
      if (wait) bc = bc.concat(op('OUTPUT_READY', LC0(0), LC0(m)));
      await this.direct(bc, 0, 0, !!wait, 60000);
    }
    async motorTime(ports, speed, ms, brake, wait) {
      const m = P.portMask(ports);
      let bc = op('OUTPUT_TIME_SPEED', LC0(0), LC0(m), LC(speed), LC(0), LC(ms), LC(0), LC0(brake === false ? 0 : 1));
      if (wait) bc = bc.concat(op('OUTPUT_READY', LC0(0), LC0(m)));
      await this.direct(bc, 0, 0, !!wait, ms + 5000);
    }
    async drive(ports, speed, turn, degrees, ms, brake, wait) {
      const m = P.portMask(ports || 'BC');
      let bc = ms ? op('OUTPUT_TIME_SYNC', LC0(0), LC0(m), LC(speed), LC2(turn || 0), LC4(ms), LC0(brake === false ? 0 : 1))
        : op('OUTPUT_STEP_SYNC', LC0(0), LC0(m), LC(speed), LC2(turn || 0), LC4(Math.abs(degrees || 0)), LC0(brake === false ? 0 : 1));
      const waits = !!wait && !!(ms || degrees);
      if (waits) bc = bc.concat(op('OUTPUT_READY', LC0(0), LC0(m)));
      await this.direct(bc, 0, 0, waits, 60000);
    }
    async motorPosition(port) { return P.rdI32(await this.direct(op('OUTPUT_GET_COUNT', LC0(0), LC0(P.portIndex(port)), GV(0)), 4), 0); }
    async motorReset(ports) { await this.direct(op('OUTPUT_CLR_COUNT', LC0(0), LC0(P.portMask(ports || 'ABCD'))), 0, 0, false); }
    async motorState(port) { const g = await this.direct(op('OUTPUT_READ', LC0(0), LC0(P.portIndex(port)), GV(0), GV(4)), 8); return { speed: P.rdI8(g[0]), tacho: P.rdI32(g, 4) }; }

    // -- programs
    async runProgram(path) {
      path = fix(path);
      await this.direct([...op('FILE', LC0(P.FILE.LOAD_IMAGE), LC2(P.USER_SLOT), LCS(path), GV(0), GV(4)), ...op('PROGRAM_START', LC2(P.USER_SLOT), GV(0), GV(4), LC0(0))], 8);
    }
    async stopProgram() { await this.direct(op('PROGRAM_STOP', LC2(P.USER_SLOT)), 0, 0, false); }
    async programRunning() { return (await this.direct(op('PROGRAM_INFO', LC0(P.PROGRAM_INFO.GET_STATUS), LC2(P.USER_SLOT), GV(0)), 1))[0] === 0x40; }
    async runBytecode(bytecodes, globals, locals) { return this.direct(bytecodes, globals || 0, locals || 0, true, 120000); }

    // -- files
    async listFiles(path) {
      path = fix(path || PRJS); if (!path.endsWith('/')) path += '/';
      let r = await this.system(P.SYS.LIST_FILES, [...P.u16(1000), ...new TextEncoder().encode(path), 0], [0, 8]);
      const size = P.rdI32(r.data, 0); let handle = r.data[4]; let text = Array.from(r.data.subarray(5)); let status = r.status;
      while (text.length < size && status !== 8) { r = await this.system(P.SYS.CONTINUE_LIST_FILES, [handle, ...P.u16(1000)], [0, 8]); handle = r.data[0]; text.push(...r.data.subarray(1)); status = r.status; }
      return P.parseFileListing(new TextDecoder().decode(Uint8Array.from(text)));
    }
    async upload(path, data, progress) {
      path = fix(path);
      let r = await this.system(P.SYS.BEGIN_DOWNLOAD, [...P.i32(data.length), ...new TextEncoder().encode(path), 0]);
      const handle = r.data[0]; let pos = 0;
      while (pos < data.length) { const part = data.subarray(pos, pos + 1000); await this.system(P.SYS.CONTINUE_DOWNLOAD, [handle, ...part], [0, 8]); pos += part.length; if (progress) await progress(pos, data.length); }
      if (!data.length) await this.system(P.SYS.CONTINUE_DOWNLOAD, [handle], [0, 8]);
    }
    async download(path, progress) {
      path = fix(path);
      let r = await this.system(P.SYS.BEGIN_UPLOAD, [...P.u16(1000), ...new TextEncoder().encode(path), 0], [0, 8]);
      const size = P.rdI32(r.data, 0); let handle = r.data[4]; const out = [...r.data.subarray(5)]; let status = r.status;
      while (out.length < size && status !== 8) { r = await this.system(P.SYS.CONTINUE_UPLOAD, [handle, ...P.u16(1000)], [0, 8]); handle = r.data[0]; out.push(...r.data.subarray(1)); status = r.status; if (progress) await progress(out.length, size); }
      return Uint8Array.from(out.slice(0, size));
    }
    async deleteFile(path) { await this.system(P.SYS.DELETE_FILE, [...new TextEncoder().encode(fix(path)), 0]); }
    async mkdir(path) { await this.system(P.SYS.CREATE_DIR, [...new TextEncoder().encode(fix(path)), 0]); }
  }
  ns.EV3 = EV3; ns.EV3Error = EV3Error; ns.PRJS = PRJS; ns.sleep = sleep;
})(OpenEV3);
