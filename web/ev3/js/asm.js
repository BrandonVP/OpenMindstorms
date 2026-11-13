/* OpenEV3 - tiny assembler for lms2012 bytecode: emits opcodes with encoded
 * parameters, resolves labels for jumps, allocates global variables, and keeps a
 * listing in the OpenEV3 assembly syntax (see js/evc.js, which can read it back). */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol;

  /* opcodes whose first parameter is a sub-code with a name in protocol.js */
  const SUBCODES = { UI_READ: P.UI_READ, UI_WRITE: P.UI_WRITE, UI_DRAW: P.UI_DRAW, UI_BUTTON: P.UI_BUTTON, SOUND: P.SOUND, INPUT_DEVICE: P.INPUT_DEVICE,
    COM_GET: P.COM_GET, COM_SET: P.COM_SET, INFO: P.INFO, FILE: P.FILE, PROGRAM_INFO: P.PROGRAM_INFO, MATH: P.MATH };
  const fmtF = v => { const s = String(v); return /[.e]/i.test(s) || !Number.isFinite(v) ? s : s + '.0'; };

  /* Global memory allocator shared by all threads of a program (4-byte aligned for floats/int32).
   * Every allocation gets a unique name so the listing can declare it. */
  class Globals {
    constructor() { this.size = 0; this.entries = []; this.nameAt = {}; this.used = new Set(); }
    alloc(bytes, name, kind) {
      if (bytes >= 4) this.size = (this.size + 3) & ~3;
      const off = this.size; this.size += bytes;
      if (bytes > 0) {
        let n = String(name || 'v').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'v';
        if (/^\d/.test(n)) n = 'v' + n;
        if (this.used.has(n)) n = n + '_' + off;
        this.used.add(n); this.entries.push({ name: n, off, bytes, kind: kind || null }); this.nameAt[off] = n;
      }
      return off;
    }
    get names() { return this.entries.map(e => e.name + ' @' + e.off); }
    get aligned() { return (this.size + 3) & ~3; }
    /* declarations in allocation order; assembling them in this order reproduces the offsets */
    decls() {
      return this.entries.map(e => {
        if (e.bytes === 1) return 'DATA8 ' + e.name;
        if (e.bytes === 2) return 'DATA16 ' + e.name;
        if (e.bytes === 4) return (e.kind === 'F' ? 'DATAF ' : 'DATA32 ') + e.name;
        return 'DATAS ' + e.name + ' ' + e.bytes;
      });
    }
  }

  class Asm {
    constructor(globals) { this.G = globals || null; this.code = []; this.labels = {}; this.fixups = []; this.lines = []; this.nlabel = 0; this.lastOp = null; }
    get pos() { return this.code.length; }
    label(name) { name = name || ('L' + (this.nlabel++)); this.labels[name] = this.pos; this.lines.push(name + ':'); return name; }
    newLabel() { return 'L' + (this.nlabel++); }
    fmtParam(p, opName, idx) {
      if (!p || !p.length) return '?';
      const b = p[0];
      if (b & 0x40) {                                   // a variable: short 0x40/0x60 | idx, long 0xC1/0xC2/0xE1/0xE2
        const isG = (b & 0x20) !== 0; let off;
        if ((b & 0x80) === 0) off = b & 0x1F; else if ((b & 7) === 1) off = p[1]; else off = p[1] | (p[2] << 8);
        return isG ? ((this.G && this.G.nameAt[off]) || ('g' + off)) : 'l' + off;
      }
      if (b === 0x84) return JSON.stringify(new TextDecoder().decode(Uint8Array.from(p.slice(1, p.length - 1))));
      let v;
      if ((b & 0x80) === 0) { v = b & 0x3F; if (v > 31) v -= 64; }
      else if (b === 0x81) v = (p[1] << 24) >> 24;
      else if (b === 0x82) v = ((p[1] | (p[2] << 8)) << 16) >> 16;
      else if (b === 0x83) { if (p.isF) return fmtF(new DataView(Uint8Array.from(p.slice(1, 5)).buffer).getFloat32(0, true)); v = (p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24)); }
      else return '?';
      if (idx === 0 && SUBCODES[opName]) { const t = SUBCODES[opName]; const name = Object.keys(t).find(k => t[k] === v); if (name) return name; }
      return String(v);
    }
    line(name, params, extra, comment) { const ps = params.map((p, i) => this.fmtParam(p, name, i)); if (extra) ps.push(extra); this.lines.push('    ' + name + '(' + ps.join(', ') + ')' + (comment ? '    ; ' + comment : '')); }
    emit(name, params, comment) {
      const bytes = P.op(name, ...params);
      this.code.push(...bytes); this.lastOp = name;
      this.line(name, params, null, comment);
    }
    /* jump instruction: params first, then a 4-byte offset to `label` (resolved at the end) */
    jump(name, params, label, comment) {
      const bytes = P.op(name, ...params);
      this.code.push(...bytes); this.lastOp = name;
      this.fixups.push({ at: this.pos, label });
      this.code.push(0x83, 0, 0, 0, 0);           // LC4 placeholder; offset is relative to the end of it
      this.line(name, params, label, comment);
    }
    finish() {
      for (const f of this.fixups) {
        if (!(f.label in this.labels)) throw new Error('unknown label ' + f.label);
        const off = this.labels[f.label] - (f.at + 5);
        this.code[f.at + 1] = off & 0xFF; this.code[f.at + 2] = (off >> 8) & 0xFF; this.code[f.at + 3] = (off >> 16) & 0xFF; this.code[f.at + 4] = (off >>> 24) & 0xFF;
      }
      return Uint8Array.from(this.code);
    }
    listing() { return this.lines.join('\n'); }
  }

  /* A whole program's listing: declarations, then one vmthread block per thread. */
  function listing(G, threads) {
    const out = G.decls().slice();
    if (out.length) out.push('');
    threads.forEach((t, i) => { out.push('vmthread ' + (t.name || (i === 0 ? 'MAIN' : 'T' + i)) + ' {'); out.push(t.asm.listing()); out.push('}'); out.push(''); });
    out.push('; globals: ' + G.aligned + ' bytes');
    return out.join('\n');
  }

  ns.asm = { Asm, Globals, SUBCODES, listing };
})(OpenEV3);
