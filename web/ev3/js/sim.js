/* OpenEV3 - simulated brick: a transport that feeds messages into the VM. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol, T = P.T;
  const enc = s => Array.from(new TextEncoder().encode(s));
  const cstr = P.cstr;

  class SimEV3 {
    constructor(opts) { this.state = new ns.vm.BrickState(); this.handles = {}; this.nextHandle = 0; this.sleeper = (opts && opts.sleeper) || null; }
    async handle(msg) {
      const m = P.parseMessage(msg);
      if (m.type === T.DIRECT_REPLY || m.type === T.DIRECT_NO_REPLY) {
        const header = m.rest[0] | (m.rest[1] << 8); const g = header & 0x3FF, l = header >> 10;
        const vm = new ns.vm.VM(this.state, g, l, m.rest.subarray(2), this.sleeper);
        let reply;
        try { await vm.run(); reply = [T.REPLY_DIRECT, ...vm.g]; }
        catch (e) { this.state.log.push('VM error: ' + e.message); reply = [T.REPLY_DIRECT_ERROR, ...vm.g]; }
        if (this.state.onChange) this.state.onChange(this.state);
        if (m.type === T.DIRECT_NO_REPLY) return null;
        return this.frame(m.counter, reply);
      }
      const cmd = m.rest[0], payload = m.rest.subarray(1);
      const [status, data] = this.system(cmd, payload);
      if (m.type === T.SYSTEM_NO_REPLY) return null;
      return this.frame(m.counter, [status === 0 || status === 8 ? T.REPLY_SYSTEM : T.REPLY_SYSTEM_ERROR, cmd, status, ...data]);
    }
    frame(counter, body) { const b = [...P.u16(counter), ...body]; return Uint8Array.from([...P.u16(b.length), ...b]); }
    h() { this.nextHandle = (this.nextHandle + 1) & 0xFF; return this.nextHandle; }
    system(cmd, a) {
      const f = this.state.files, S = P.SYS;
      if (cmd === S.BEGIN_DOWNLOAD) { const size = P.rdI32(a, 0); const name = cstr(a.subarray(4)); const h = this.h(); this.handles[h] = { name, size, data: [] }; return [0, [h]]; }
      if (cmd === S.CONTINUE_DOWNLOAD) { const h = a[0], fh = this.handles[h]; if (!fh) return [1, [h]]; fh.data.push(...a.subarray(1)); if (fh.data.length >= fh.size) { f[fh.name] = Uint8Array.from(fh.data.slice(0, fh.size)); delete this.handles[h]; return [8, [h]]; } return [0, [h]]; }
      if (cmd === S.BEGIN_UPLOAD || cmd === S.BEGIN_GETFILE) { const maxb = a[0] | (a[1] << 8); const name = cstr(a.subarray(2)); if (!(name in f)) return [6, []]; const data = f[name]; const h = this.h(); const status = data.length <= maxb ? 8 : 0; if (status === 0) this.handles[h] = { name, pos: maxb }; return [status, [...P.i32(data.length), h, ...data.subarray(0, maxb)]]; }
      if (cmd === S.CONTINUE_UPLOAD || cmd === S.CONTINUE_GETFILE) { const h = a[0], maxb = a[1] | (a[2] << 8), fh = this.handles[h]; if (!fh) return [1, [h]]; const data = f[fh.name]; const part = data.subarray(fh.pos, fh.pos + maxb); fh.pos += part.length; const status = fh.pos >= data.length ? 8 : 0; if (status === 8) delete this.handles[h]; return [status, [h, ...part]]; }
      if (cmd === S.LIST_FILES) {
        const maxb = a[0] | (a[1] << 8); const path = cstr(a.subarray(2)); const names = Object.keys(f).filter(n => n.startsWith(path)).sort(); const lines = []; const seen = new Set();
        for (const n of names) { const rest = n.slice(path.length); if (rest.includes('/')) { const d = rest.split('/')[0] + '/'; if (!seen.has(d)) { seen.add(d); lines.push(d); } } else lines.push('0'.repeat(32) + ' ' + f[n].length.toString(16).toUpperCase().padStart(8, '0') + ' ' + rest); }
        const text = enc(lines.join('\n') + (lines.length ? '\n' : '')); const h = this.h();
        if (text.length <= maxb) return [8, [...P.i32(text.length), h, ...text]];
        this.handles[h] = { text, pos: maxb }; return [0, [...P.i32(text.length), h, ...text.slice(0, maxb)]];
      }
      if (cmd === S.CONTINUE_LIST_FILES) { const h = a[0], maxb = a[1] | (a[2] << 8), fh = this.handles[h]; if (!fh) return [1, [h]]; const part = fh.text.slice(fh.pos, fh.pos + maxb); fh.pos += part.length; return [fh.pos >= fh.text.length ? 8 : 0, [h, ...part]]; }
      if (cmd === S.CREATE_DIR) return [0, []];
      if (cmd === S.DELETE_FILE) { const n = cstr(a); if (!(n in f)) return [6, []]; delete f[n]; return [0, []]; }
      if (cmd === S.CLOSE_FILEHANDLE) { delete this.handles[a[0]]; return [0, []]; }
      return [10, []];
    }
  }

  class SimTransport {
    constructor(opts) { this.name = 'Simulator'; this.ev3 = new SimEV3(opts); this.queue = []; this.txLog = []; this.label = 'simulated brick'; }
    static available() { return true; }
    async open() { return this; }
    async send(msg) { this.txLog.push(Uint8Array.from(msg)); const r = await this.ev3.handle(Uint8Array.from(msg)); if (r) this.queue.push(r); }
    async recv() { return this.queue.length ? this.queue.shift() : null; }
    async close() {}
  }
  ns.sim = { SimEV3, SimTransport };
})(OpenEV3);
