/* OpenNXT - browser transports: WebUSB (the brick's USB port, needs WinUSB on
 * Windows) and Web Serial (the Bluetooth COM port Windows creates when paired). */
var OpenNXT = (typeof OpenNXT !== 'undefined') ? OpenNXT : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class UsbTransport {
    constructor() { this.name = 'USB'; this.dev = null; this.pending = []; }
    static available() { return typeof navigator !== 'undefined' && !!navigator.usb; }
    async open() {
      this.dev = await navigator.usb.requestDevice({ filters: [{ vendorId: P.USB.VID, productId: P.USB.PID }] });
      await this.dev.open();
      if (this.dev.configuration === null) await this.dev.selectConfiguration(1);
      await this.dev.claimInterface(0);
      this.label = 'USB' + (this.dev.serialNumber ? ' (' + this.dev.serialNumber + ')' : '');
      return this;
    }
    async send(msg) { await this.dev.transferOut(P.USB.EP_OUT, msg); }
    async recv(timeoutMs) {
      // WebUSB transfers have no timeout; race against a timer.
      let timer;
      const t = new Promise(res => { timer = setTimeout(() => res(null), timeoutMs); });
      const r = await Promise.race([this.dev.transferIn(P.USB.EP_IN, P.USB.PACKET).then(x => x, () => null), t]);
      clearTimeout(timer);
      if (!r || !r.data) return null;
      return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    }
    async flush() { /* nothing buffered on our side */ }
    async close() { try { if (this.dev) await this.dev.close(); } catch (e) { /* ignore */ } this.dev = null; }
  }

  class BluetoothSerialTransport {
    constructor() { this.name = 'Bluetooth'; this.port = null; this.rx = []; this.rxLen = 0; this.closed = false; }
    static available() { return typeof navigator !== 'undefined' && !!navigator.serial; }
    async open() {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200, bufferSize: 16384 });
      this.writer = this.port.writable.getWriter();
      this.closed = false;
      this._readLoop();
      this.label = 'Bluetooth serial port';
      return this;
    }
    async _readLoop() {
      while (this.port && this.port.readable && !this.closed) {
        const reader = this.port.readable.getReader(); this.reader = reader;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) { this.rx.push(value); this.rxLen += value.length; } } }
        catch (e) { /* non-fatal */ }
        finally { reader.releaseLock(); }
      }
    }
    _take(n) {
      const out = new Uint8Array(n); let p = 0;
      while (p < n) { const c = this.rx[0]; const take = Math.min(c.length, n - p); out.set(c.subarray(0, take), p); p += take; if (take === c.length) this.rx.shift(); else this.rx[0] = c.subarray(take); }
      this.rxLen -= n; return out;
    }
    async send(msg) { await this.writer.write(P.btFrame(msg)); }
    async recv(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (this.rxLen >= 2) {
          const all = this._peek(2); const len = all[0] | (all[1] << 8);
          if (this.rxLen >= 2 + len) { this._take(2); return this._take(len); }
        }
        if (Date.now() >= deadline) return null;
        await sleep(5);
      }
    }
    _peek(n) { const out = new Uint8Array(n); let p = 0; for (const c of this.rx) { const take = Math.min(c.length, n - p); out.set(c.subarray(0, take), p); p += take; if (p >= n) break; } return out; }
    async flush() { this.rx = []; this.rxLen = 0; }
    async close() {
      this.closed = true;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { /* ignore */ }
      try { if (this.writer) this.writer.releaseLock(); } catch (e) { /* ignore */ }
      try { if (this.port) await this.port.close(); } catch (e) { /* ignore */ }
      this.port = null;
    }
  }

  ns.transports = { UsbTransport, BluetoothSerialTransport, sleep };
})(OpenNXT);
