/* OpenRCX - byte transports for the browser: Web Serial (DIY or LEGO serial tower)
 * and WebUSB (original LEGO USB tower). Each keeps a receive buffer filled by a
 * background read loop; the link layer scans that buffer for replies. */
var OpenRCX = (typeof OpenRCX !== 'undefined') ? OpenRCX : {};
(function (ns) {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class RxBuffer {
    constructor() { this.chunks = []; this.length = 0; }
    push(bytes) { if (bytes && bytes.length) { this.chunks.push(bytes); this.length += bytes.length; } }
    bytes() {
      if (this.chunks.length === 1) return this.chunks[0];
      const out = new Uint8Array(this.length);
      let p = 0;
      for (const c of this.chunks) { out.set(c, p); p += c.length; }
      this.chunks = out.length ? [out] : [];
      return out;
    }
    consume(n) {
      const all = this.bytes();
      const rest = all.subarray(n);
      this.chunks = rest.length ? [rest] : [];
      this.length = rest.length;
    }
    clear() { this.chunks = []; this.length = 0; }
  }

  /* ------------------------------------------------------------ Web Serial */
  class SerialTransport {
    constructor(kind) {
      this.kind = kind;                      // 'diy' or 'serial'
      this.name = kind === 'serial' ? 'LEGO serial tower' : 'OpenRCX DIY tower';
      this.echoes = kind === 'serial';
      this.rx = new RxBuffer();
      this.port = null;
      this.writer = null;
      this.closed = false;
      this.errors = 0;
    }
    static available() { return typeof navigator !== 'undefined' && !!navigator.serial; }

    async open() {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 2400, dataBits: 8, parity: 'odd', stopBits: 1, bufferSize: 65536 });
      try {
        await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
      } catch (e) { /* some CDC devices refuse; harmless */ }
      this.writer = this.port.writable.getWriter();
      this.closed = false;
      this._readLoop();
      const info = this.port.getInfo();
      this.portLabel = info.usbVendorId
        ? 'USB ' + info.usbVendorId.toString(16).padStart(4, '0') + ':' + (info.usbProductId || 0).toString(16).padStart(4, '0')
        : 'serial port';
      return this;
    }

    async _readLoop() {
      while (this.port && this.port.readable && !this.closed) {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) this.rx.push(value);
          }
        } catch (e) {
          // parity/framing errors are non-fatal: port.readable is replaced
          this.errors++;
        } finally {
          reader.releaseLock();
        }
      }
    }

    async write(bytes) { await this.writer.write(bytes); }
    flush() { this.rx.clear(); }
    txSeconds(n) { return n * 11 / 2400; }

    async close() {
      this.closed = true;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { /* ignore */ }
      try { if (this.writer) { this.writer.releaseLock(); } } catch (e) { /* ignore */ }
      try { if (this.port) await this.port.close(); } catch (e) { /* ignore */ }
      this.port = null;
    }
  }

  /* ------------------------------------------------------------ WebUSB (LEGO USB tower) */
  const LTW = { GET_PARM: 0x01, SET_PARM: 0x02, FLUSH: 0x03, RESET: 0x04, GET_STAT: 0x05,
    SET_TX_SPEED: 0xEF, SET_RX_SPEED: 0xF1, SET_TX_CARRIER_FREQUENCY: 0xF4, GET_CAPS: 0xFC,
    GET_VERSION: 0xFD };
  const PARM = { MODE: 0x01, RANGE: 0x02, ERRDETECT: 0x03 };
  const MODE_IR = 0x02;
  const RANGE = { short: 1, medium: 2, long: 3 };
  const BAUD_2400 = 0x0008;

  class UsbTowerTransport {
    constructor(range) {
      this.name = 'LEGO USB tower';
      this.echoes = false;
      this.rx = new RxBuffer();
      this.range = range || 'medium';
      this.dev = null;
      this.closed = false;
    }
    static available() { return typeof navigator !== 'undefined' && !!navigator.usb; }

    async vendor(request, value, length) {
      const r = await this.dev.controlTransferIn({ requestType: 'vendor', recipient: 'device', request, value, index: 0 }, length);
      const d = new Uint8Array(r.data.buffer);
      if (d.length >= 3 && d[2] !== 0) throw new Error('USB tower request 0x' + request.toString(16) + ' failed with code ' + d[2]);
      return d;
    }

    async open() {
      this.dev = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0694, productId: 0x0001 }] });
      await this.dev.open();
      if (this.dev.configuration === null) await this.dev.selectConfiguration(1);
      await this.dev.claimInterface(0);
      await this.vendor(LTW.RESET, 0, 8);
      await sleep(100);
      await this.vendor(LTW.SET_PARM, PARM.MODE | (MODE_IR << 8), 4);
      await this.vendor(LTW.SET_TX_SPEED, BAUD_2400, 6);
      await this.vendor(LTW.SET_RX_SPEED, BAUD_2400, 6);
      await this.vendor(LTW.SET_PARM, PARM.RANGE | (RANGE[this.range] << 8), 4);
      const v = await this.vendor(LTW.GET_VERSION, 0, 8);
      this.portLabel = 'tower firmware ' + v[4] + '.' + v[5];
      this.closed = false;
      this._readLoop();
      return this;
    }

    async _readLoop() {
      while (this.dev && !this.closed) {
        try {
          const r = await this.dev.transferIn(1, 8);
          if (r.data && r.data.byteLength) this.rx.push(new Uint8Array(r.data.buffer));
          else await sleep(5);
        } catch (e) {
          if (this.closed) break;
          await sleep(20);
        }
      }
    }

    async write(bytes) {
      for (let i = 0; i < bytes.length; i += 8) {
        await this.dev.transferOut(2, bytes.subarray(i, Math.min(i + 8, bytes.length)));
      }
    }
    flush() { this.rx.clear(); }
    txSeconds(n) { return n * 11 / 2400; }
    async close() {
      this.closed = true;
      try { if (this.dev) await this.dev.close(); } catch (e) { /* ignore */ }
      this.dev = null;
    }
  }

  ns.transports = { RxBuffer, SerialTransport, UsbTowerTransport, sleep };
})(OpenRCX);
