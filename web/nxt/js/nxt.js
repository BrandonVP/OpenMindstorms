/* OpenNXT - the brick API (browser port of python/opennxt/brick.py). */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
(function (ns) {
  'use strict';
  const P = ns.protocol, C = P.CMD, T = P.T;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class NXT {
    constructor(transport, opts) {
      this.t = transport;
      this.log = (opts && opts.log) || null;
      this.timeout = 1000;
      this.stats = { sent: 0, errors: 0 };
      this.busy = false;
    }

    async call(type, command, payload, okStatuses, timeoutMs) {
      okStatuses = okStatuses || [0];
      const msg = P.build(type, command, payload || []);
      this.stats.sent++;
      if (this.log) this.log('tx', msg, P.commandName(command));
      await this.t.send(msg);
      if (type & 0x80) return { status: 0, payload: new Uint8Array(0) };
      const deadline = Date.now() + (timeoutMs || this.timeout);
      for (;;) {
        const reply = await this.t.recv(Math.max(10, deadline - Date.now()));
        if (!reply) { this.stats.errors++; throw new Error('no reply to ' + P.commandName(command) + ' (is the brick on and connected?)'); }
        if (this.log) this.log('rx', reply, '');
        if (reply.length >= 2 && reply[0] === T.REPLY && reply[1] === command) {
          const r = P.parseReply(reply);
          if (!okStatuses.includes(r.status)) { this.stats.errors++; throw new P.NxtError(command, r.status); }
          return r;
        }
        if (Date.now() >= deadline) { this.stats.errors++; throw new Error('unexpected reply to ' + P.commandName(command)); }
      }
    }
    async direct(command, payload, reply) { return (await this.call(reply === false ? T.DIRECT_NOREPLY : T.DIRECT, command, payload)).payload; }
    async system(command, payload, ok, timeoutMs) { return (await this.call(T.SYSTEM, command, payload, ok, timeoutMs)).payload; }

    // -- identity
    async deviceInfo() {
      const d = await this.system(C.GET_DEVICE_INFO);
      return { name: P.cstr(d.subarray(0, 15)), btAddress: Array.from(d.subarray(15, 21), b => b.toString(16).toUpperCase().padStart(2, '0')).join(':'),
        btSignal: P.rdU32(d, 22), freeFlash: P.rdU32(d, 26) };
    }
    async firmwareVersion() { const d = await this.system(C.GET_FIRMWARE_VERSION); return { protocol: d[1] + '.' + String(d[0]).padStart(2, '0'), firmware: d[3] + '.' + String(d[2]).padStart(2, '0') }; }
    async setBrickName(name) { const b = new Uint8Array(16); b.set(new TextEncoder().encode(name).subarray(0, 15)); await this.system(C.SET_BRICK_NAME, b); }
    async batteryMv() { const d = await this.direct(C.GET_BATTERY_LEVEL); return P.rdU16(d, 0); }
    async keepAlive() { const d = await this.direct(C.KEEP_ALIVE); return P.rdU32(d, 0); }

    // -- sound
    async playTone(hz, ms, reply) { await this.direct(C.PLAY_TONE, [...P.u16(Math.max(200, Math.min(14000, hz))), ...P.u16(Math.max(1, ms))], reply); }
    async playSoundFile(name, loop) { await this.direct(C.PLAY_SOUND_FILE, [loop ? 1 : 0, ...P.name20(name)]); }
    async stopSound() { await this.direct(C.STOP_SOUND_PLAYBACK); }

    // -- motors
    async setOutputState(port, power, mode, regulation, turnRatio, runState, tachoLimit, reply) {
      const clamp = v => Math.max(-100, Math.min(100, Math.round(v)));
      await this.direct(C.SET_OUTPUT_STATE, [P.motorPort(port), P.s8(clamp(power)), mode, regulation, P.s8(clamp(turnRatio || 0)), runState, ...P.u32(tachoLimit || 0)], reply);
    }
    async motorRun(port, power, degrees, opts) {
      opts = opts || {};
      const regulated = opts.regulated !== false, brake = opts.brake !== false;
      const mode = P.MOTOR.ON | (brake ? P.MOTOR.BRAKE : 0) | (regulated ? P.MOTOR.REGULATED : 0);
      await this.setOutputState(port, power, mode, regulated ? P.REG.SPEED : P.REG.IDLE, 0, P.RUN.RUNNING, Math.abs(degrees || 0), opts.reply);
    }
    async motorsSync(power, turnRatio, degrees, ports, brake) {
      const mode = P.MOTOR.ON | (brake === false ? 0 : P.MOTOR.BRAKE) | P.MOTOR.REGULATED;
      for (const p of (ports || ['B', 'C'])) await this.setOutputState(p, power, mode, P.REG.SYNC, turnRatio || 0, P.RUN.RUNNING, Math.abs(degrees || 0));
    }
    async motorStop(port, brake, reply) {
      if (brake === false) await this.setOutputState(port, 0, 0, P.REG.IDLE, 0, P.RUN.IDLE, 0, reply);
      else await this.setOutputState(port, 0, P.MOTOR.ON | P.MOTOR.BRAKE | P.MOTOR.REGULATED, P.REG.SPEED, 0, P.RUN.RUNNING, 0, reply);
    }
    async motorsStop(brake) { await this.motorStop(P.PORT_ALL, brake); }
    async getOutputState(port) {
      const d = await this.direct(C.GET_OUTPUT_STATE, [P.motorPort(port)]);
      const s = { port: d[0], power: P.rdI8(d[1]), mode: d[2], regulation: d[3], turnRatio: P.rdI8(d[4]), runState: d[5],
        tachoLimit: P.rdU32(d, 6), tachoCount: P.rdI32(d, 10), blockTachoCount: P.rdI32(d, 14), rotationCount: P.rdI32(d, 18) };
      s.running = !!(s.mode & P.MOTOR.ON) && s.runState !== P.RUN.IDLE;
      return s;
    }
    async resetMotorPosition(port, relative) { await this.direct(C.RESET_MOTOR_POSITION, [P.motorPort(port), relative ? 1 : 0]); }

    // -- sensors
    async setInputMode(port, type, mode) {
      const t = P.sensorTypeCode(type);
      if (mode === undefined || mode === null || mode === '') {
        const tname = type === 'ultrasonic' ? 'ultrasonic' : (P.SENSOR_TYPE_NAMES[t] || 'none');
        mode = P.DEFAULT_MODE[tname] || 'raw';
      }
      await this.direct(C.SET_INPUT_MODE, [P.sensorPort(port), t, P.sensorModeCode(mode)]);
    }
    async getInputValues(port) {
      const d = await this.direct(C.GET_INPUT_VALUES, [P.sensorPort(port)]);
      const v = { port: d[0], valid: !!d[1], calibrated: !!d[2], sensorType: d[3], sensorMode: d[4], raw: P.rdU16(d, 5), normalized: P.rdU16(d, 7), scaled: P.rdI16(d, 9), calibratedValue: P.rdI16(d, 11) };
      v.typeName = P.SENSOR_TYPE_NAMES[v.sensorType] || ('0x' + v.sensorType.toString(16));
      v.modeName = P.SENSOR_MODE_NAMES[v.sensorMode & 0xE0] || ('0x' + v.sensorMode.toString(16));
      return v;
    }
    async sensorValue(port) { return (await this.getInputValues(port)).scaled; }
    async resetScaledValue(port) { await this.direct(C.RESET_INPUT_SCALED_VALUE, [P.sensorPort(port)]); }

    async lsWrite(port, tx, rxLen) { await this.direct(C.LS_WRITE, [P.sensorPort(port), tx.length, rxLen, ...tx]); }
    async lsStatus(port) { const r = await this.call(T.DIRECT, C.LS_GET_STATUS, [P.sensorPort(port)], [0, 0x20]); return r.status === 0x20 ? -1 : r.payload[0]; }
    async lsRead(port) { const d = await this.direct(C.LS_READ, [P.sensorPort(port)]); return d.subarray(1, 1 + d[0]); }
    async ultrasonicSetup(port) { await this.setInputMode(port, 'lowspeed_9v', 'raw'); await sleep(100); }
    async ultrasonicCm(port, timeoutMs) {
      await this.lsWrite(port, [0x02, 0x42], 1);
      const deadline = Date.now() + (timeoutMs || 500);
      for (;;) {
        let n;
        try { n = await this.lsStatus(port); } catch (e) { if (e.status === 0x20) n = -1; else throw e; }
        if (n >= 1) break;
        if (Date.now() >= deadline) throw new Error('ultrasonic sensor did not answer; is it on port ' + port + '?');
        await sleep(10);
      }
      const d = await this.lsRead(port);
      return !d.length || d[0] === 255 ? null : d[0];
    }

    // -- messages
    async messageWrite(inbox, text) {
      let b = new TextEncoder().encode(String(text)).subarray(0, 58);
      const m = new Uint8Array(b.length + 1); m.set(b);
      await this.direct(C.MESSAGE_WRITE, [inbox & 0x0F, m.length, ...m]);
    }
    async messageRead(inbox, remove) {
      const r = await this.call(T.DIRECT, C.MESSAGE_READ, [(inbox & 0x0F) + 10, inbox & 0x0F, remove === false ? 0 : 1], [0, 0x40]);
      if (r.status === 0x40) return null;
      return P.cstr(r.payload.subarray(2, 2 + r.payload[1]));
    }

    // -- programs
    async startProgram(name) { await this.direct(C.START_PROGRAM, P.name20(name)); }
    async stopProgram() { await this.call(T.DIRECT, C.STOP_PROGRAM, [], [0, 0xEC]); }
    async currentProgram() { const r = await this.call(T.DIRECT, C.GET_CURRENT_PROGRAM_NAME, [], [0, 0xEC]); return r.status ? null : P.cstr(r.payload.subarray(0, 20)); }

    // -- files
    async listFiles(pattern) {
      const out = [];
      let d;
      try { d = await this.system(C.FIND_FIRST, P.name20(pattern || '*.*')); }
      catch (e) { if (e.status === 0x87 || e.status === 0x83) return out; throw e; }
      let handle = d[0];
      out.push({ name: P.cstr(d.subarray(1, 21)), size: P.rdU32(d, 21) });
      try {
        for (;;) { d = await this.system(C.FIND_NEXT, [handle]); handle = d[0]; out.push({ name: P.cstr(d.subarray(1, 21)), size: P.rdU32(d, 21) }); }
      } catch (e) { if (e.status !== 0x83 && e.status !== 0x87) throw e; }
      finally { try { await this.system(C.CLOSE, [handle]); } catch (e) { /* ignore */ } }
      return out;
    }
    async deleteFile(name) { await this.system(C.DELETE, P.name20(name)); }
    async upload(name, data, progress, replace) {
      if (replace !== false) { try { await this.deleteFile(name); } catch (e) { if (e.status !== 0x87 && e.status !== 0xBD) throw e; } }
      const op = P.isLinearFile(name) ? C.OPEN_WRITE_LINEAR : C.OPEN_WRITE;
      const handle = (await this.system(op, [...P.name20(name), ...P.u32(data.length)]))[0];
      try {
        let pos = 0;
        while (pos < data.length) {
          const chunk = data.subarray(pos, pos + P.WRITE_CHUNK);
          const d = await this.system(C.WRITE, [handle, ...chunk]);
          if (P.rdU16(d, 1) !== chunk.length) throw new P.NxtError(C.WRITE, 0x8E);
          pos += chunk.length;
          if (progress) await progress(pos, data.length);
        }
      } finally { await this.system(C.CLOSE, [handle]); }
    }
    async download(name, progress) {
      const d0 = await this.system(C.OPEN_READ, P.name20(name));
      const handle = d0[0], size = P.rdU32(d0, 1);
      const out = new Uint8Array(size); let pos = 0;
      try {
        while (pos < size) {
          const n = Math.min(P.WRITE_CHUNK, size - pos);
          const d = await this.system(C.READ, [handle, ...P.u16(n)]);
          const got = P.rdU16(d, 1);
          if (!got) break;
          out.set(d.subarray(3, 3 + got), pos); pos += got;
          if (progress) await progress(pos, size);
        }
      } finally { try { await this.system(C.CLOSE, [handle]); } catch (e) { /* ignore */ } }
      return out.subarray(0, pos);
    }
    async deleteUserFlash() { await this.system(C.DELETE_USER_FLASH, [], [0], 10000); }
  }

  ns.NXT = NXT;
})(OpenNXT);
