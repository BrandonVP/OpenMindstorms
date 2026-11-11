/* OpenEV3 - browser transports: WebHID (USB, no driver needed) and Web Serial (Bluetooth). */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class HidTransport {
    constructor() { this.name = 'USB'; this.dev = null; this.queue = []; this.waiters = []; }
    static available() { return typeof navigator !== 'undefined' && !!navigator.hid; }
    async open() {
      const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: P.USB.VID, productId: P.USB.PID }] });
      if (!devs.length) { const e = new Error('No device chosen.'); e.name = 'NotFoundError'; throw e; }
      this.dev = devs[0];
      await this.dev.open();
      this.dev.addEventListener('inputreport', ev => {
        const d = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
        const w = this.waiters.shift(); if (w) w(d); else this.queue.push(d);
      });
      this.label = 'USB (' + (this.dev.productName || 'EV3') + ')';
      return this;
    }
    async send(msg) {
      const report = new Uint8Array(P.USB.REPORT); report.set(msg.subarray(0, P.USB.REPORT));
      await this.dev.sendReport(0, report);
    }
    recv(timeoutMs) {
      if (this.queue.length) return Promise.resolve(this.queue.shift());
      return new Promise(resolve => {
        const w = d => { clearTimeout(timer); resolve(d); };
        const timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); resolve(null); }, timeoutMs);
        this.waiters.push(w);
      });
    }
    async close() { try { if (this.dev) await this.dev.close(); } catch (e) { /* ignore */ } this.dev = null; }
  }

  class BluetoothSerialTransport {
    constructor() { this.name = 'Bluetooth'; this.port = null; this.rx = []; this.rxLen = 0; this.closed = false; }
    static available() { return typeof navigator !== 'undefined' && !!navigator.serial; }
    async open() {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200, bufferSize: 16384 });
      this.writer = this.port.writable.getWriter(); this.closed = false; this._readLoop(); this.label = 'Bluetooth serial port';
      return this;
    }
    async _readLoop() {
      while (this.port && this.port.readable && !this.closed) {
        const reader = this.port.readable.getReader(); this.reader = reader;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) { this.rx.push(value); this.rxLen += value.length; } } }
        catch (e) { /* non-fatal */ } finally { reader.releaseLock(); }
      }
    }
    _take(n) { const out = new Uint8Array(n); let p = 0; while (p < n) { const c = this.rx[0]; const take = Math.min(c.length, n - p); out.set(c.subarray(0, take), p); p += take; if (take === c.length) this.rx.shift(); else this.rx[0] = c.subarray(take); } this.rxLen -= n; return out; }
    _peek(n) { const out = new Uint8Array(n); let p = 0; for (const c of this.rx) { const take = Math.min(c.length, n - p); out.set(c.subarray(0, take), p); p += take; if (p >= n) break; } return out; }
    async send(msg) { await this.writer.write(msg); }
    async recv(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (this.rxLen >= 2) { const h = this._peek(2); const len = h[0] | (h[1] << 8); if (this.rxLen >= 2 + len) return this._take(2 + len); }
        if (Date.now() >= deadline) return null;
        await sleep(5);
      }
    }
    async close() { this.closed = true; try { if (this.reader) await this.reader.cancel(); } catch (e) { /* ignore */ } try { if (this.writer) this.writer.releaseLock(); } catch (e) { /* ignore */ } try { if (this.port) await this.port.close(); } catch (e) { /* ignore */ } this.port = null; }
  }
  ns.transports = { HidTransport, BluetoothSerialTransport, sleep };
})(OpenEV3);
