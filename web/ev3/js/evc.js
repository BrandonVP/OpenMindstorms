/* OpenEV3 - EVC: a small C-like language in the spirit of NQC and NXC, compiled to
 * lms2012 bytecode in the browser for the stock EV3 firmware. Also the text form of
 * that bytecode (the assembly listing), which can be assembled back to bytes.
 *
 *   tokenizer -> parser (AST) -> code generator (through asm.js) -> bytes
 *
 * Programs are `task main() { ... }` plus other tasks (VM threads started with
 * `start name;`), functions (inlined at each call, so they work in "Run now" too),
 * global and local variables of type int / float / bool, and an API of NXC-flavoured
 * calls for motors, sensors, display, sound, buttons and timing.
 * Plain script: runs from file:// and in Node tests. Needs protocol.js and asm.js. */
var OpenEV3 = (typeof OpenEV3 !== 'undefined') ? OpenEV3 : {};
(function (ns) {
  'use strict';
  const P = ns.protocol, A = ns.asm;
  const { LC, LC0, LC2, LCF, LCS, GV } = P;

  class EVCError extends Error { constructor(msg, line, col) { super(msg); this.name = 'EVCError'; this.line = line || 0; this.col = col || 0; } }
  const err = (msg, tok) => new EVCError(msg, tok && tok.line, tok && tok.col);

  /* ------------------------------------------------------------------ constants */
  const CONSTS = {
    OUT_A: 1, OUT_B: 2, OUT_C: 4, OUT_D: 8, OUT_AB: 3, OUT_AC: 5, OUT_AD: 9, OUT_BC: 6, OUT_BD: 10, OUT_CD: 12, OUT_ABC: 7, OUT_ABD: 11, OUT_ACD: 13, OUT_BCD: 14, OUT_ABCD: 15,
    S1: 0, S2: 1, S3: 2, S4: 3, IN_1: 0, IN_2: 1, IN_3: 2, IN_4: 3,
    LCD_LINE1: 0, LCD_LINE2: 12, LCD_LINE3: 24, LCD_LINE4: 36, LCD_LINE5: 48, LCD_LINE6: 60, LCD_LINE7: 72, LCD_LINE8: 84, LCD_LINE9: 96, LCD_LINE10: 108,
    LCD_WIDTH: 178, LCD_HEIGHT: 128,
    BTN_UP: 1, BTN_ENTER: 2, BTN_CENTER: 2, BTN_DOWN: 3, BTN_RIGHT: 4, BTN_LEFT: 5, BTN_BACK: 6, BTN_ANY: 7,
    LED_OFF: 0, LED_GREEN: 1, LED_RED: 2, LED_ORANGE: 3, LED_GREEN_FLASH: 4, LED_RED_FLASH: 5, LED_ORANGE_FLASH: 6, LED_GREEN_PULSE: 7, LED_RED_PULSE: 8, LED_ORANGE_PULSE: 9,
    COLOR_NONE: 0, COLOR_BLACK: 1, COLOR_BLUE: 2, COLOR_GREEN: 3, COLOR_YELLOW: 4, COLOR_RED: 5, COLOR_WHITE: 6, COLOR_BROWN: 7,
    TONE_C4: 262, TONE_CS4: 277, TONE_D4: 294, TONE_DS4: 311, TONE_E4: 330, TONE_F4: 349, TONE_FS4: 370, TONE_G4: 392, TONE_GS4: 415, TONE_A4: 440, TONE_AS4: 466, TONE_B4: 494,
    TONE_C5: 523, TONE_CS5: 554, TONE_D5: 587, TONE_DS5: 622, TONE_E5: 659, TONE_F5: 698, TONE_FS5: 740, TONE_G5: 784, TONE_GS5: 831, TONE_A5: 880, TONE_AS5: 932, TONE_B5: 988, TONE_C6: 1047,
    MS_10: 10, MS_50: 50, MS_100: 100, MS_200: 200, MS_500: 500, SEC_1: 1000, SEC_2: 2000, SEC_5: 5000,
    IR_CH1: 0, IR_CH2: 1, IR_CH3: 2, IR_CH4: 3,
  };
  const FLOAT_CONSTS = { PI: Math.PI };

  /* ------------------------------------------------------------------ tokenizer */
  const KEYWORDS = new Set(['task', 'sub', 'void', 'inline', 'int', 'long', 'short', 'char', 'byte', 'unsigned', 'float', 'bool', 'string', 'if', 'else', 'while', 'until', 'do', 'for', 'repeat',
    'break', 'continue', 'return', 'start', 'stop', 'true', 'false', 'const', 'switch', 'case', 'default']);
  const PUNCT = ['<<=', '>>=', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', ';', ',', '(', ')', '{', '}', '[', ']'];
  function tokenize(src, defines, depth) {
    defines = defines || {}; depth = depth || 0;
    const toks = []; let i = 0, line = 1, col = 1; const n = src.length;
    const push = (type, value, l, c, extra) => toks.push(Object.assign({ type, value, line: l, col: c }, extra || {}));
    while (i < n) {
      const ch = src[i], l = line, c = col;
      if (ch === '\n') { i++; line++; col = 1; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f') { i++; col++; continue; }
      if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { i++; col++; } continue; }
      if (ch === '/' && src[i + 1] === '*') {
        i += 2; col += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; }
        if (i >= n) throw new EVCError('comment never closed', l, c);
        i += 2; col += 2; continue;
      }
      if (ch === '#' && /^\s*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))) {
        let j = i; while (j < n && src[j] !== '\n') j++; const text = src.slice(i, j);
        const m = /^#\s*define\s+([A-Za-z_]\w*)(\s+(.*))?$/.exec(text.replace(/\/\/.*$/, '').trim());
        if (m) { if (/^\(/.test(m[2] || '')) throw new EVCError('#define with arguments is not supported', l, c); defines[m[1]] = (m[3] || '').trim(); }
        else if (/^#\s*(include|pragma|download|undef)\b/.test(text)) { /* ignored */ }
        else throw new EVCError('unknown directive: ' + text.trim().split(/\s/)[0], l, c);
        col += j - i; i = j; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let m = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i, i + 20));
        if (m) { push('num', parseInt(m[0], 16), l, c, { isFloat: false }); i += m[0].length; col += m[0].length; continue; }
        m = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
        const isFloat = /[.eE]/.test(m[0]);
        push('num', isFloat ? parseFloat(m[0]) : parseInt(m[0], 10), l, c, { isFloat }); i += m[0].length; col += m[0].length; continue;
      }
      if (ch === '"' || ch === '\'') {
        let j = i + 1, s = '';
        while (j < n && src[j] !== ch) { if (src[j] === '\n') throw new EVCError('string never closed', l, c); if (src[j] === '\\') { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; } else s += src[j++]; }
        if (j >= n) throw new EVCError('string never closed', l, c);
        if (ch === '\'' && s.length === 1) push('num', s.charCodeAt(0), l, c, { isFloat: false }); else push('str', s, l, c);
        col += j + 1 - i; i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j); col += j - i; i = j;
        if (word in defines) {
          if (depth > 16) throw new EVCError('#define ' + word + ' refers to itself', l, c);
          for (const t of tokenize(defines[word], defines, depth + 1)) { if (t.type === 'eof') continue; t.line = l; t.col = c; toks.push(t); }
          continue;
        }
        push(KEYWORDS.has(word) ? 'kw' : 'ident', word, l, c); continue;
      }
      const p = PUNCT.find(s => src.startsWith(s, i));
      if (!p) throw new EVCError('unexpected character "' + ch + '"', l, c);
      push('op', p, l, c); i += p.length; col += p.length;
    }
    push('eof', '', line, col);
    return toks;
  }

  /* ------------------------------------------------------------------ parser */
  const TYPE_WORDS = { int: 'int', long: 'int', short: 'int', char: 'int', byte: 'int', unsigned: 'int', float: 'float', bool: 'bool', string: 'str', void: 'void' };
  function parse(tokens) {
    let i = 0;
    const peek = (k) => tokens[Math.min(i + (k || 0), tokens.length - 1)];
    const at = (type, value) => peek().type === type && (value === undefined || peek().value === value);
    const atOp = v => at('op', v), atKw = v => at('kw', v);
    const describe = t => t.type === 'eof' ? 'end of program' : '"' + t.value + '"';
    const accept = (type, value) => at(type, value) ? tokens[i++] : null;
    const expect = (type, value, what) => { const t = accept(type, value); if (!t) throw err('expected ' + (what || value || type) + ' but found ' + describe(peek()), peek()); return t; };
    const expectOp = (v, what) => expect('op', v, what || '"' + v + '"');
    const prog = { tasks: [], funcs: [], globals: [], consts: {} };

    function typeName() {
      let t = null;
      while (at('kw') && TYPE_WORDS[peek().value]) { const w = tokens[i++].value; if (w !== 'unsigned') t = TYPE_WORDS[w]; else t = t || 'int'; }
      return t;
    }
    function declarator(type, allowInit) {
      const name = expect('ident', undefined, 'a name'); let size = null, init = null;
      if (accept('op', '[')) { size = expression(); expectOp(']'); }
      if (allowInit && accept('op', '=')) init = expression();
      return { name: name.value, type, size, init, tok: name };
    }
    function block() {
      expectOp('{'); const body = [];
      while (!atOp('}')) { if (at('eof')) throw err('missing "}"', peek()); body.push(statement()); }
      expectOp('}'); return { k: 'block', body };
    }
    function statement() {
      const t = peek();
      if (atOp('{')) return block();
      if (accept('op', ';')) return { k: 'empty' };
      if (atKw('if')) { i++; expectOp('('); const cond = expression(); expectOp(')'); const then = statement(); let els = null; if (accept('kw', 'else')) els = statement(); return { k: 'if', cond, then, els, tok: t }; }
      if (atKw('while')) { i++; expectOp('('); const cond = expression(); expectOp(')'); return { k: 'while', cond, body: statement(), tok: t }; }
      if (atKw('until')) { i++; expectOp('('); const cond = expression(); expectOp(')'); if (accept('op', ';')) return { k: 'until', cond, tok: t }; return { k: 'while', cond: { k: 'un', op: '!', e: cond, tok: t }, body: statement(), tok: t }; }
      if (atKw('do')) { i++; const body = statement(); expect('kw', 'while'); expectOp('('); const cond = expression(); expectOp(')'); expectOp(';'); return { k: 'dowhile', cond, body, tok: t }; }
      if (atKw('repeat')) { i++; expectOp('('); const n = expression(); expectOp(')'); return { k: 'repeat', n, body: statement(), tok: t }; }
      if (atKw('for')) {
        i++; expectOp('(');
        let init = null; if (!atOp(';')) { const ty = typeName(); init = ty ? { k: 'decl', decls: declList(ty), tok: t } : { k: 'expr', e: expression(), tok: t }; } expectOp(';');
        const cond = atOp(';') ? null : expression(); expectOp(';');
        const step = atOp(')') ? null : expression(); expectOp(')');
        return { k: 'for', init, cond, step, body: statement(), tok: t };
      }
      if (atKw('switch')) {
        i++; expectOp('('); const e = expression(); expectOp(')'); expectOp('{'); const cases = [];
        while (!atOp('}')) {
          if (at('eof')) throw err('missing "}"', peek());
          let value = null; if (accept('kw', 'default')) { /* default */ } else { expect('kw', 'case'); value = expression(); }
          expectOp(':'); const body = [];
          while (!atKw('case') && !atKw('default') && !atOp('}')) { if (at('eof')) throw err('missing "}"', peek()); body.push(statement()); }
          cases.push({ value, body });
        }
        expectOp('}'); return { k: 'switch', e, cases, tok: t };
      }
      if (atKw('break')) { i++; expectOp(';'); return { k: 'break', tok: t }; }
      if (atKw('continue')) { i++; expectOp(';'); return { k: 'continue', tok: t }; }
      if (atKw('return')) { i++; const e = atOp(';') ? null : expression(); expectOp(';'); return { k: 'return', e, tok: t }; }
      if (atKw('start') || atKw('stop')) { const kw = tokens[i++].value; const name = expect('ident', undefined, 'a task name'); expectOp(';'); return { k: kw, name: name.value, tok: name }; }
      if (atKw('const')) { i++; const ty = typeName(); if (!ty) throw err('expected a type after const', peek()); const d = declarator(ty, true); expectOp(';'); if (!d.init) throw err('const needs a value', d.tok); return { k: 'const', decl: d, tok: t }; }
      const ty = typeName();
      if (ty) { if (ty === 'void') throw err('void is only for functions', t); const decls = declList(ty); expectOp(';'); return { k: 'decl', decls, tok: t }; }
      const e = expression(); expectOp(';', '";" after the statement'); return { k: 'expr', e, tok: t };
    }
    function declList(type) { const out = [declarator(type, true)]; while (accept('op', ',')) out.push(declarator(type, true)); return out; }

    // expressions, lowest precedence first
    const ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='];
    function expression() { return assignment(); }
    function assignment() {
      const left = ternary();
      if (at('op') && ASSIGN_OPS.includes(peek().value)) {
        const opTok = tokens[i++]; const right = assignment();
        if (left.k !== 'var' && left.k !== 'index') throw err('can only assign to a variable', opTok);
        return { k: 'assign', op: opTok.value, target: left, e: right, tok: opTok };
      }
      return left;
    }
    function ternary() { const c = binary(0); if (accept('op', '?')) { const a = assignment(); expectOp(':'); const b = assignment(); return { k: 'cond', c, a, b, tok: c.tok }; } return c; }
    const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    function binary(level) {
      if (level >= LEVELS.length) return unary();
      let left = binary(level + 1);
      while (at('op') && LEVELS[level].includes(peek().value)) { const opTok = tokens[i++]; const right = binary(level + 1); left = { k: 'bin', op: opTok.value, a: left, b: right, tok: opTok }; }
      return left;
    }
    function unary() {
      const t = peek();
      if (at('op') && ['-', '+', '!', '~'].includes(t.value)) { i++; return { k: 'un', op: t.value, e: unary(), tok: t }; }
      if (at('op') && (t.value === '++' || t.value === '--')) { i++; const target = unary(); if (target.k !== 'var' && target.k !== 'index') throw err(t.value + ' needs a variable', t); return { k: 'incdec', op: t.value, target, prefix: true, tok: t }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (at('op') && (peek().value === '++' || peek().value === '--')) { const t = tokens[i++]; if (e.k !== 'var' && e.k !== 'index') throw err(t.value + ' needs a variable', t); e = { k: 'incdec', op: t.value, target: e, prefix: false, tok: t }; continue; }
        if (atOp('[')) { const t = tokens[i++]; const idx = expression(); expectOp(']'); e = { k: 'index', a: e, idx, tok: t }; continue; }
        return e;
      }
    }
    function primary() {
      const t = peek();
      if (at('num')) { i++; return { k: 'num', v: t.value, isFloat: !!t.isFloat, tok: t }; }
      if (at('str')) { i++; return { k: 'str', v: t.value, tok: t }; }
      if (atKw('true') || atKw('false')) { i++; return { k: 'bool', v: t.value === 'true', tok: t }; }
      if (accept('op', '(')) { const e = expression(); expectOp(')'); return e; }
      if (at('ident')) {
        i++;
        if (accept('op', '(')) { const args = []; if (!atOp(')')) { args.push(expression()); while (accept('op', ',')) args.push(expression()); } expectOp(')'); return { k: 'call', name: t.value, args, tok: t }; }
        return { k: 'var', name: t.value, tok: t };
      }
      throw err('expected a value but found ' + describe(t), t);
    }

    // program level
    while (!at('eof')) {
      const t = peek();
      if (accept('kw', 'task')) { const name = expect('ident', undefined, 'a task name'); expectOp('('); expectOp(')'); prog.tasks.push({ name: name.value, body: block(), tok: name }); continue; }
      if (accept('kw', 'const')) { const ty = typeName(); if (!ty) throw err('expected a type after const', peek()); const d = declarator(ty, true); expectOp(';'); if (!d.init) throw err('const needs a value', d.tok); prog.globals.push(Object.assign(d, { isConst: true })); continue; }
      accept('kw', 'inline');
      let ty = atKw('sub') ? (i++, 'void') : typeName();
      if (ty === null) throw err('expected task, a type or a function but found ' + describe(t), t);
      const name = expect('ident', undefined, 'a name');
      if (accept('op', '(')) {
        const params = [];
        if (!atOp(')')) { do { const pt = typeName(); if (!pt || pt === 'void') throw err('expected a parameter type', peek()); const pn = expect('ident', undefined, 'a parameter name'); params.push({ type: pt, name: pn.value, tok: pn }); } while (accept('op', ',')); }
        expectOp(')');
        if (name.value === 'main') throw err('write "task main()" for the main program', name);
        prog.funcs.push({ name: name.value, ret: ty, params, body: block(), tok: name });
        continue;
      }
      if (ty === 'void') throw err('void is only for functions', t);
      i--; // back to the name
      prog.globals.push(...declList(ty)); expectOp(';');
    }
    return prog;
  }

  /* ------------------------------------------------------------------ code generation */
  const SIZE = { int: 4, float: 4, bool: 1 };
  const isNum = t => t === 'int' || t === 'float';
  const portIndexOf = (v, tok) => { if (!('c' in v)) throw err('this needs a single motor port such as OUT_A', tok); const i = [1, 2, 4, 8].indexOf(v.c | 0); if (i < 0) throw err('expected one motor port (OUT_A..OUT_D)', tok); return i; };

  class CG {
    constructor(G, shared, name) {
      this.G = G; this.S = shared; this.a = new A.Asm(G); this.name = name;
      this.scopes = [shared.globals]; this.live = []; this.free = { 1: [], 2: [], 4: [] }; this.loops = []; this.inl = []; this.fnDepth = 0;
      this.scratch = shared.scratch;
    }
    // temporaries: reused within a thread, released at the end of each statement
    tmp(bytes, kind) { const f = this.free[bytes]; const off = f.length ? f.pop() : this.G.alloc(bytes, 't' + (kind || bytes), kind === 'F' ? 'F' : null); this.live.push({ off, bytes }); return off; }
    mark() { return this.live.length; }
    release(m) { while (this.live.length > m) { const t = this.live.pop(); this.free[t.bytes].push(t.off); } }
    tmpOf(type) { return this.tmp(SIZE[type], type === 'float' ? 'F' : null); }
    // scopes
    push() { this.scopes.push(new Map()); }
    pop() { this.scopes.pop(); }
    lookup(name) { for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name); return null; }
    declare(d) {
      const scope = this.scopes[this.scopes.length - 1];
      if (scope.has(d.name) && this.scopes.length > 1) throw err('"' + d.name + '" is already declared here', d.tok);
      if (d.type === 'str') { const size = d.size ? constInt(d.size, this.S, d.tok) : 32; const v = { t: 'str', off: this.G.alloc(size + 1, d.name), size: size + 1 }; scope.set(d.name, v); return v; }
      if (d.size) { const n = constInt(d.size, this.S, d.tok); if (n < 1 || n > 1000) throw err('array size must be 1..1000', d.tok); const v = { t: 'array', et: d.type, n, off: this.G.alloc(SIZE[d.type] * n, d.name, d.type === 'float' ? 'F' : null) }; scope.set(d.name, v); return v; }
      const v = { t: d.type, off: this.G.alloc(SIZE[d.type], d.name, d.type === 'float' ? 'F' : null) }; scope.set(d.name, v); return v;
    }

    /* ---- operands: turn a value {t, c} or {t, off} into encoded parameter bytes of a given VM type */
    opI32(v, tok) {
      if (v.t === 'str' || v.t === 'array') throw err('expected a number', tok);
      if ('c' in v) return LC(v.t === 'bool' ? (v.c ? 1 : 0) : Math.trunc(v.c));
      if (v.t === 'int') return GV(v.off);
      const t = this.tmp(4); this.a.emit(v.t === 'float' ? 'MOVEF_32' : 'MOVE8_32', [GV(v.off), GV(t)]); return GV(t);
    }
    opI16(v, tok) {
      if (v.t === 'str' || v.t === 'array') throw err('expected a number', tok);
      if ('c' in v) return LC(Math.max(-32768, Math.min(32767, Math.trunc(v.t === 'bool' ? (v.c ? 1 : 0) : v.c))));
      const t = this.tmp(2); this.a.emit({ int: 'MOVE32_16', float: 'MOVEF_16', bool: 'MOVE8_16' }[v.t], [GV(v.off), GV(t)]); return GV(t);
    }
    opI8(v, tok) {
      if (v.t === 'str' || v.t === 'array') throw err('expected a number', tok);
      if ('c' in v) return LC(Math.max(-128, Math.min(127, Math.trunc(v.t === 'bool' ? (v.c ? 1 : 0) : v.c))));
      if (v.t === 'bool') return GV(v.off);
      const t = this.tmp(1); this.a.emit(v.t === 'float' ? 'MOVEF_8' : 'MOVE32_8', [GV(v.off), GV(t)]); return GV(t);
    }
    opF(v, tok) {
      if (v.t === 'str' || v.t === 'array') throw err('expected a number', tok);
      if ('c' in v) return LCF(v.t === 'bool' ? (v.c ? 1 : 0) : v.c);
      if (v.t === 'float') return GV(v.off);
      const t = this.tmp(4, 'F'); this.a.emit(v.t === 'int' ? 'MOVE32_F' : 'MOVE8_F', [GV(v.off), GV(t)]); return GV(t);
    }
    opBool(v, tok) {
      if (v.t === 'str' || v.t === 'array') throw err('expected a condition', tok);
      if ('c' in v) return LC0(v.c ? 1 : 0);
      if (v.t === 'bool') return GV(v.off);
      return GV(this.boolTmp(v, tok).off);
    }
    opStr(v, tok) { if (v.t !== 'str') throw err('expected text in quotes', tok); return 'c' in v ? LCS(v.c) : GV(v.off); }
    operand(v, type, tok) { return type === 'float' ? this.opF(v, tok) : type === 'bool' ? this.opBool(v, tok) : this.opI32(v, tok); }
    /* a value materialised in a temp of the given type */
    boolTmp(v, tok) { const t = this.tmp(1); this.a.emit(v.t === 'float' ? 'CP_NEQF' : 'CP_NEQ32', [GV(v.off), v.t === 'float' ? LCF(0) : LC0(0), GV(t)]); return { t: 'bool', off: t }; }
    toType(v, type, tok) {
      if (v.t === type) return v;
      if (v.t === 'str' || v.t === 'array' || type === 'str') throw err('expected a ' + (type === 'str' ? 'text value' : 'number'), tok);
      if (type === 'bool') return 'c' in v ? { t: 'bool', c: !!v.c } : this.boolTmp(v, tok);
      if ('c' in v) return { t: type, c: type === 'bool' ? !!v.c : type === 'int' ? Math.trunc(v.t === 'bool' ? (v.c ? 1 : 0) : v.c) : (v.t === 'bool' ? (v.c ? 1 : 0) : v.c) };
      const t = this.tmpOf(type);
      this.a.emit(type === 'float' ? (v.t === 'int' ? 'MOVE32_F' : 'MOVE8_F') : type === 'int' ? (v.t === 'float' ? 'MOVEF_32' : 'MOVE8_32') : null, [GV(v.off), GV(t)]);
      return { t: type, off: t };
    }
    // store a value into a variable
    store(dst, v, tok) {
      if (dst.t === 'str') { if (v.t !== 'str') throw err('a string variable needs text', tok); this.a.emit('STRINGS', [LC0(2), this.opStr(v, tok), LCS(''), LC(dst.size), GV(dst.off)]); return; }
      if (v.t === 'str' || v.t === 'array') throw err('cannot assign that to "' + dst.t + '"', tok);
      if (dst.t === 'float') this.a.emit('MOVEF_F', [this.opF(v, tok), GV(dst.off)]);
      else if (dst.t === 'int') this.a.emit('MOVE32_32', [this.opI32(v, tok), GV(dst.off)]);
      else this.a.emit('MOVE8_8', [this.opBool(v, tok), GV(dst.off)]);
    }

    /* ---- expressions: return a value {t, c} (constant) or {t, off} (in memory) */
    expr(e) {
      switch (e.k) {
        case 'num': return { t: e.isFloat ? 'float' : 'int', c: e.v };
        case 'str': return { t: 'str', c: e.v };
        case 'bool': return { t: 'bool', c: e.v };
        case 'var': {
          const v = this.lookup(e.name);
          if (v) { if (v.t === 'const') return { t: v.ct, c: v.c }; return v; }
          if (e.name in CONSTS) return { t: 'int', c: CONSTS[e.name] };
          if (e.name in FLOAT_CONSTS) return { t: 'float', c: FLOAT_CONSTS[e.name] };
          const m = /^SENSOR_([1-4])$/.exec(e.name); if (m) return BUILTINS.SensorValue.gen(this, [{ t: 'int', c: Number(m[1]) - 1 }], e.tok);
          throw err('"' + e.name + '" is not declared', e.tok);
        }
        case 'index': return this.indexRead(e);
        case 'cond': {
          const c = this.expr(e.c); const t = this.exprType(e.a) === 'float' || this.exprType(e.b) === 'float' ? 'float' : this.exprType(e.a);
          if ('c' in c) return this.toType(this.expr(c.c ? e.a : e.b), t, e.tok);
          const r = this.tmpOf(t); const Lb = this.a.newLabel(), Lend = this.a.newLabel();
          this.a.jump('JR_FALSE', [this.opBool(c, e.tok)], Lb); this.store({ t, off: r }, this.expr(e.a), e.tok); this.a.jump('JR', [], Lend);
          this.a.label(Lb); this.store({ t, off: r }, this.expr(e.b), e.tok); this.a.label(Lend); return { t, off: r };
        }
        case 'un': return this.unary(e);
        case 'bin': return this.binary(e);
        case 'assign': return this.assign(e);
        case 'incdec': {
          const target = this.lvalue(e.target); if (!isNum(target.t)) throw err(e.op + ' needs a number variable', e.tok);
          const old = e.prefix ? null : this.copy(target);
          this.a.emit(target.t === 'float' ? (e.op === '++' ? 'ADDF' : 'SUBF') : (e.op === '++' ? 'ADD32' : 'SUB32'), [GV(target.off), target.t === 'float' ? LCF(1) : LC0(1), GV(target.off)]);
          if (e.target.k === 'index') this.indexWrite(e.target, target);
          return old || target;
        }
        case 'call': return this.call(e);
        default: throw err('cannot evaluate this', e.tok);
      }
    }
    copy(v) { const t = this.tmpOf(v.t); this.a.emit({ int: 'MOVE32_32', float: 'MOVEF_F', bool: 'MOVE8_8' }[v.t], [GV(v.off), GV(t)]); return { t: v.t, off: t }; }
    /* static type of an expression without emitting code (for mixed-type decisions) */
    exprType(e) {
      switch (e.k) {
        case 'num': return e.isFloat ? 'float' : 'int';
        case 'str': return 'str';
        case 'bool': return 'bool';
        case 'var': { const v = this.lookup(e.name); if (v) return v.t === 'const' ? v.ct : v.t; if (e.name in FLOAT_CONSTS) return 'float'; if (e.name in CONSTS || /^SENSOR_[1-4]$/.test(e.name)) return /^SENSOR_/.test(e.name) ? 'float' : 'int'; throw err('"' + e.name + '" is not declared', e.tok); }
        case 'index': { const a = this.lookup(e.a.name); return a && a.t === 'array' ? a.et : 'int'; }
        case 'cond': { const a = this.exprType(e.a), b = this.exprType(e.b); return a === 'float' || b === 'float' ? 'float' : a; }
        case 'un': return e.op === '!' ? 'bool' : this.exprType(e.e);
        case 'bin': { if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(e.op)) return 'bool'; const a = this.exprType(e.a), b = this.exprType(e.b); return a === 'float' || b === 'float' ? 'float' : 'int'; }
        case 'assign': return this.exprType(e.target);
        case 'incdec': return this.exprType(e.target);
        case 'call': { const f = this.S.funcs[e.name]; if (f) return f.ret; const b = BUILTINS[e.name]; if (b) return b.ret === 'num' ? (e.args.some(a => this.exprType(a) === 'float') ? 'float' : 'int') : b.ret; throw err('unknown function "' + e.name + '"', e.tok); }
        default: return 'int';
      }
    }
    lvalue(e) {
      if (e.k === 'var') { const v = this.lookup(e.name); if (!v) throw err('"' + e.name + '" is not declared', e.tok); if (v.t === 'const') throw err('"' + e.name + '" is a constant', e.tok); if (v.t === 'array') throw err('"' + e.name + '" is an array; use an index', e.tok); return v; }
      if (e.k === 'index') { const a = this.lookup(e.a.name); if (!a || a.t !== 'array') throw err('"' + (e.a.name || '?') + '" is not an array', e.tok); const t = this.tmpOf(a.et); const idx = this.expr(e.idx); this.arrayRead(a, idx, t, e.tok); return { t: a.et, off: t, array: a, idx }; }
      throw err('can only assign to a variable', e.tok);
    }
    /* arrays live in global memory; element access goes through a byte offset computed at run time (constant indices are folded) */
    arrayAddr(a, idx, tok) {
      const es = SIZE[a.et];
      if ('c' in idx) { const i = Math.trunc(idx.c); if (i < 0 || i >= a.n) throw err('index ' + i + ' is outside the array (0..' + (a.n - 1) + ')', tok); return { c: a.off + i * es }; }
      const t = this.tmp(4); this.a.emit('MUL32', [this.opI32(idx, tok), LC(es), GV(t)]); this.a.emit('ADD32', [GV(t), LC(a.off), GV(t)]); return { off: t };
    }
    arrayRead(a, idx, dst, tok) {
      const addr = this.arrayAddr(a, idx, tok); const size = SIZE[a.et];
      if ('c' in addr) this.a.emit({ int: 'MOVE32_32', float: 'MOVEF_F', bool: 'MOVE8_8' }[a.et], [GV(addr.c), GV(dst)]);
      else this.a.emit('MEMORY_READ', [LC0(-1), LC0(0), GV(addr.off), LC(size), GV(dst)], 'read ' + a.et + ' from the array');
    }
    arrayWrite(a, idx, v, tok) {
      const addr = this.arrayAddr(a, idx, tok); const size = SIZE[a.et];
      if ('c' in addr) this.store({ t: a.et, off: addr.c }, v, tok);
      else { const src = this.toType(v, a.et, tok); let so; if ('c' in src) { so = this.tmpOf(a.et); this.store({ t: a.et, off: so }, src, tok); } else so = src.off; this.a.emit('MEMORY_WRITE', [LC0(-1), LC0(0), GV(addr.off), LC(size), GV(so)], 'write into the array'); }
    }
    indexRead(e) { const a = this.lookup(e.a.name); if (!a || a.t !== 'array') throw err('"' + (e.a.name || '?') + '" is not an array', e.tok); const idx = this.expr(e.idx); const t = this.tmpOf(a.et); this.arrayRead(a, idx, t, e.tok); return { t: a.et, off: t }; }
    indexWrite(e, v) { const a = this.lookup(e.a.name); this.arrayWrite(a, this.expr(e.idx), v, e.tok); }

    unary(e) {
      const v = this.expr(e.e);
      if (e.op === '+') return v;
      if (e.op === '!') { if ('c' in v) return { t: 'bool', c: !v.c }; const t = this.tmp(1); this.a.emit('XOR8', [this.opBool(v, e.tok), LC0(1), GV(t)]); return { t: 'bool', off: t }; }
      if (v.t === 'str' || v.t === 'array') throw err('expected a number', e.tok);
      if (e.op === '-') { if ('c' in v) return { t: v.t === 'float' ? 'float' : 'int', c: -(v.t === 'bool' ? (v.c ? 1 : 0) : v.c) }; const ty = v.t === 'float' ? 'float' : 'int'; const t = this.tmpOf(ty); this.a.emit(ty === 'float' ? 'SUBF' : 'SUB32', [ty === 'float' ? LCF(0) : LC0(0), this.operand(v, ty, e.tok), GV(t)]); return { t: ty, off: t }; }
      // ~
      if ('c' in v) return { t: 'int', c: ~Math.trunc(v.c) }; const t = this.tmp(4); this.a.emit('XOR32', [this.opI32(v, e.tok), LC(-1), GV(t)]); return { t: 'int', off: t };
    }
    binary(e) {
      const op = e.op;
      if (op === '&&' || op === '||') {
        const a = this.expr(e.a);
        if ('c' in a) { if (op === '&&' ? !a.c : !!a.c) return { t: 'bool', c: !!a.c }; const b = this.expr(e.b); return 'c' in b ? { t: 'bool', c: !!b.c } : this.toType(b, 'bool', e.tok); }
        const t = this.tmp(1); const Lshort = this.a.newLabel(), Lend = this.a.newLabel();
        this.a.jump(op === '&&' ? 'JR_FALSE' : 'JR_TRUE', [this.opBool(a, e.tok)], Lshort);
        const b = this.expr(e.b); this.a.emit('MOVE8_8', [this.opBool(b, e.tok), GV(t)]); this.a.jump('JR', [], Lend);
        this.a.label(Lshort); this.a.emit('MOVE8_8', [LC0(op === '&&' ? 0 : 1), GV(t)]); this.a.label(Lend);
        return { t: 'bool', off: t };
      }
      const a = this.expr(e.a), b = this.expr(e.b);
      if (a.t === 'str' || b.t === 'str') {
        if (op === '+') { if ('c' in a && 'c' in b) return { t: 'str', c: String(a.c) + String(b.c) }; const t = this.G.alloc(65, 'strcat'); this.a.emit('STRINGS', [LC0(2), this.opStr(a, e.tok), this.opStr(b, e.tok), LC(65), GV(t)]); return { t: 'str', off: t, size: 65 }; }
        if (op === '==' || op === '!=') { const t = this.tmp(1); this.a.emit('STRINGS', [LC0(3), this.opStr(a, e.tok), this.opStr(b, e.tok), GV(t)]); if (op === '!=') this.a.emit('XOR8', [GV(t), LC0(1), GV(t)]); return { t: 'bool', off: t }; }
        throw err('strings only support + and ==', e.tok);
      }
      if (a.t === 'array' || b.t === 'array') throw err('arrays need an index', e.tok);
      const fl = a.t === 'float' || b.t === 'float';
      const av = a.t === 'bool' ? (('c' in a) ? { t: 'int', c: a.c ? 1 : 0 } : a) : a, bv = b.t === 'bool' ? (('c' in b) ? { t: 'int', c: b.c ? 1 : 0 } : b) : b;
      if ('c' in av && 'c' in bv) {
        const x = av.c, y = bv.c; let r;
        switch (op) {
          case '+': r = x + y; break; case '-': r = x - y; break; case '*': r = x * y; break;
          case '/': if (y === 0) throw err('division by zero', e.tok); r = fl ? x / y : Math.trunc(x / y); break;
          case '%': if (y === 0) throw err('division by zero', e.tok); r = x % y; break;
          case '==': return { t: 'bool', c: x === y }; case '!=': return { t: 'bool', c: x !== y }; case '<': return { t: 'bool', c: x < y }; case '>': return { t: 'bool', c: x > y }; case '<=': return { t: 'bool', c: x <= y }; case '>=': return { t: 'bool', c: x >= y };
          case '&': r = x & y; break; case '|': r = x | y; break; case '^': r = x ^ y; break; case '<<': r = x << y; break; case '>>': r = x >> y; break;
        }
        return { t: fl ? 'float' : 'int', c: r };
      }
      const cmp = { '==': 'EQ', '!=': 'NEQ', '<': 'LT', '>': 'GT', '<=': 'LTEQ', '>=': 'GTEQ' }[op];
      if (cmp) { const t = this.tmp(1); this.a.emit('CP_' + cmp + (fl ? 'F' : '32'), [this.operand(av, fl ? 'float' : 'int', e.tok), this.operand(bv, fl ? 'float' : 'int', e.tok), GV(t)]); return { t: 'bool', off: t }; }
      const ty = fl ? 'float' : 'int';
      if (op === '%') { const t = this.tmpOf(ty); this.a.emit('MATH', [LC0(fl ? P.MATH.MOD : P.MATH.MOD32), this.operand(av, ty, e.tok), this.operand(bv, ty, e.tok), GV(t)]); return { t: ty, off: t }; }
      if (op === '<<' || op === '>>') {
        if (fl) throw err('shifts need whole numbers', e.tok);
        if (!('c' in bv)) throw err('the shift amount must be a constant', e.tok);
        const t = this.tmp(4); const k = Math.pow(2, Math.max(0, Math.min(30, bv.c | 0))); this.a.emit(op === '<<' ? 'MUL32' : 'DIV32', [this.opI32(av, e.tok), LC(k), GV(t)]); return { t: 'int', off: t };
      }
      if (op === '&' || op === '|' || op === '^') { if (fl) throw err('bit operations need whole numbers', e.tok); const t = this.tmp(4); this.a.emit({ '&': 'AND32', '|': 'OR32', '^': 'XOR32' }[op], [this.opI32(av, e.tok), this.opI32(bv, e.tok), GV(t)]); return { t: 'int', off: t }; }
      const opn = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV' }[op]; if (!opn) throw err('unsupported operator ' + op, e.tok);
      // operands must not share the result temp with a later use: evaluate first, then allocate the result
      const pa = this.operand(av, ty, e.tok), pb = this.operand(bv, ty, e.tok); const t = this.tmpOf(ty);
      this.a.emit(opn + (fl ? 'F' : '32'), [pa, pb, GV(t)]); return { t: ty, off: t };
    }
    assign(e) {
      if (e.target.k === 'index' && e.op === '=') {   // plain store into an array element: no need to read it first
        const a = this.lookup(e.target.a.name); if (!a || a.t !== 'array') throw err('"' + (e.target.a.name || '?') + '" is not an array', e.tok);
        const v = this.toType(this.expr(e.e), a.et, e.tok); this.arrayWrite(a, this.expr(e.target.idx), v, e.tok); return v;
      }
      const target = this.lvalue(e.target);
      let v = this.expr(e.e);
      if (e.op !== '=') { const bop = e.op.slice(0, -1); v = this.binary({ k: 'bin', op: bop, a: { k: 'lit', v: target }, b: { k: 'lit', v }, tok: e.tok }); }
      this.store(target, v, e.tok);
      if (e.target.k === 'index') this.arrayWrite(target.array, target.idx, target, e.tok);
      return target;
    }
    /* ---- function calls */
    call(e) {
      const f = this.S.funcs[e.name];
      if (f) return this.inlineCall(f, e);
      const b = BUILTINS[e.name];
      if (!b) throw err('unknown function "' + e.name + '"', e.tok);
      if (e.args.length < b.min || e.args.length > b.args.length) throw err(e.name + ' takes ' + (b.min === b.args.length ? b.min : b.min + ' to ' + b.args.length) + ' argument' + (b.args.length === 1 ? '' : 's'), e.tok);
      const vals = e.args.map(a => this.expr(a));
      return b.gen(this, vals, e.tok, e.args);
    }
    inlineCall(f, e) {
      if (this.inl.includes(f.name)) throw err('"' + f.name + '" calls itself; recursion is not supported', e.tok);
      if (e.args.length !== f.params.length) throw err(f.name + ' takes ' + f.params.length + ' argument' + (f.params.length === 1 ? '' : 's'), e.tok);
      const vals = e.args.map(a => this.expr(a));
      this.inl.push(f.name); this.push();
      const frame = { ret: null, end: this.a.newLabel() };
      if (f.ret !== 'void') frame.ret = { t: f.ret, off: this.G.alloc(SIZE[f.ret] || 4, f.name + '_ret', f.ret === 'float' ? 'F' : null) };
      f.params.forEach((p, i) => { const v = this.declare({ name: p.name, type: p.type, tok: p.tok }); this.store(v, vals[i], e.args[i].tok); });
      const saveLoops = this.loops; this.loops = []; const saveFrame = this.frame; this.frame = frame;
      this.stmt(f.body);
      this.loops = saveLoops; this.frame = saveFrame;
      this.a.label(frame.end);
      this.pop(); this.inl.pop();
      return frame.ret || { t: 'void' };
    }

    /* ---- statements */
    stmts(list) { for (const s of list) this.stmt(s); }
    stmt(s) {
      const m = this.mark();
      try { this.stmt1(s); } finally { this.release(m); }
    }
    stmt1(s) {
      switch (s.k) {
        case 'empty': return;
        case 'block': this.push(); this.stmts(s.body); this.pop(); return;
        case 'expr': { const v = this.expr(s.e); if (!s.noCheck && (s.e.k === 'var' || s.e.k === 'num' || s.e.k === 'str')) throw err('this line does nothing', s.tok); return; }
        case 'decl': for (const d of s.decls) { const v = this.declare(d); if (d.init) { if (v.t === 'array') throw err('arrays cannot be initialised yet; assign the elements', d.tok); this.store(v, this.expr(d.init), d.tok); } } return;
        case 'const': { const d = s.decl; const c = constValue(d.init, this.S, d.tok, this); this.scopes[this.scopes.length - 1].set(d.name, { t: 'const', ct: d.type === 'float' ? 'float' : d.type === 'bool' ? 'bool' : 'int', c }); return; }
        case 'if': {
          const c = this.expr(s.cond);
          if ('c' in c) { if (c.c) this.stmt(s.then); else if (s.els) this.stmt(s.els); return; }
          const Lelse = this.a.newLabel(), Lend = this.a.newLabel();
          this.a.jump('JR_FALSE', [this.opBool(c, s.tok)], s.els ? Lelse : Lend);
          this.stmt(s.then);
          if (s.els) { this.a.jump('JR', [], Lend); this.a.label(Lelse); this.stmt(s.els); }
          this.a.label(Lend); return;
        }
        case 'while': {
          const Ltop = this.a.label(), Lend = this.a.newLabel();
          const c = this.expr(s.cond);
          if ('c' in c) { if (!c.c) return; } else this.a.jump('JR_FALSE', [this.opBool(c, s.tok)], Lend);
          this.loops.push({ brk: Lend, cont: Ltop }); this.stmt(s.body); this.loops.pop();
          this.a.jump('JR', [], Ltop); this.a.label(Lend); return;
        }
        case 'dowhile': {
          const Ltop = this.a.label(), Lcont = this.a.newLabel(), Lend = this.a.newLabel();
          this.loops.push({ brk: Lend, cont: Lcont }); this.stmt(s.body); this.loops.pop();
          this.a.label(Lcont); const c = this.expr(s.cond);
          if ('c' in c) { if (c.c) this.a.jump('JR', [], Ltop); } else this.a.jump('JR_TRUE', [this.opBool(c, s.tok)], Ltop);
          this.a.label(Lend); return;
        }
        case 'until': {   // wait until the condition holds, polling every 10 ms
          const Ltop = this.a.label(); const c = this.expr(s.cond);
          if ('c' in c) { if (!c.c) throw err('until(false) would wait forever', s.tok); return; }
          this.waitMs({ t: 'int', c: 10 }); this.a.jump('JR_FALSE', [this.opBool(c, s.tok)], Ltop, 'poll'); return;
        }
        case 'repeat': {
          const n = this.expr(s.n); const counter = this.G.alloc(4, 'repeat'); const Ltop = this.a.newLabel(), Lcont = this.a.newLabel(), Lend = this.a.newLabel();
          const limit = this.toType(n, 'int', s.tok); let lim; if ('c' in limit) lim = LC(limit.c); else { lim = this.G.alloc(4, 'repeat_n'); this.a.emit('MOVE32_32', [GV(limit.off), GV(lim)]); lim = GV(lim); }
          this.a.emit('MOVE32_32', [LC0(0), GV(counter)]); this.a.label(Ltop);
          this.a.jump('JR_GTEQ32', [GV(counter), lim], Lend);
          this.loops.push({ brk: Lend, cont: Lcont }); this.stmt(s.body); this.loops.pop();
          this.a.label(Lcont); this.a.emit('ADD32', [GV(counter), LC0(1), GV(counter)]); this.a.jump('JR', [], Ltop); this.a.label(Lend); return;
        }
        case 'for': {
          this.push();
          if (s.init) this.stmt(s.init);
          const Ltop = this.a.label(), Lcont = this.a.newLabel(), Lend = this.a.newLabel();
          if (s.cond) { const c = this.expr(s.cond); if ('c' in c) { if (!c.c) { this.pop(); return; } } else this.a.jump('JR_FALSE', [this.opBool(c, s.tok)], Lend); }
          this.loops.push({ brk: Lend, cont: Lcont }); this.stmt(s.body); this.loops.pop();
          this.a.label(Lcont); if (s.step) this.stmt({ k: 'expr', e: s.step, tok: s.tok, noCheck: true });
          this.a.jump('JR', [], Ltop); this.a.label(Lend); this.pop(); return;
        }
        case 'switch': {
          const v = this.expr(s.e); const ty = v.t === 'float' ? 'float' : 'int';
          const keep = this.G.alloc(4, 'switch', ty === 'float' ? 'F' : null); this.store({ t: ty, off: keep }, v, s.tok);
          const Lend = this.a.newLabel(); const labels = s.cases.map(() => this.a.newLabel()); let Ldefault = Lend;
          s.cases.forEach((c, i) => { if (c.value === null) { Ldefault = labels[i]; return; } const cv = this.toType(this.expr(c.value), ty, s.tok); this.a.jump('JR_EQ' + (ty === 'float' ? 'F' : '32'), [GV(keep), this.operand(cv, ty, s.tok)], labels[i]); });
          this.a.jump('JR', [], Ldefault);
          this.loops.push({ brk: Lend, cont: this.loops.length ? this.loops[this.loops.length - 1].cont : null, isSwitch: true });
          s.cases.forEach((c, i) => { this.a.label(labels[i]); this.stmts(c.body); });
          this.loops.pop(); this.a.label(Lend); return;
        }
        case 'break': { if (!this.loops.length) throw err('break outside a loop', s.tok); this.a.jump('JR', [], this.loops[this.loops.length - 1].brk, 'break'); return; }
        case 'continue': { const l = [...this.loops].reverse().find(x => x.cont); if (!l) throw err('continue outside a loop', s.tok); this.a.jump('JR', [], l.cont, 'continue'); return; }
        case 'return': {
          if (!this.frame) { if (s.e) throw err('a task cannot return a value', s.tok); this.a.emit('OBJECT_END', [], 'return from task'); return; }
          if (this.frame.ret) { if (!s.e) throw err('this function must return a value', s.tok); this.store(this.frame.ret, this.expr(s.e), s.tok); }
          else if (s.e) throw err('this function returns nothing', s.tok);
          this.a.jump('JR', [], this.frame.end, 'return'); return;
        }
        case 'start': case 'stop': {
          const t = this.S.taskIndex[s.name]; if (t === undefined) throw err('no task called "' + s.name + '"', s.tok);
          if (s.name === 'main') throw err('main is already running', s.tok);
          this.a.emit(s.k === 'start' ? 'OBJECT_START' : 'OBJECT_STOP', [LC2(t)], s.k + ' task ' + s.name); this.S.usesThreads = true; return;
        }
        default: throw err('unsupported statement', s.tok);
      }
    }
    waitMs(v, tok) { this.a.emit('TIMER_WAIT', [this.opI32(v, tok), GV(this.scratch)]); this.a.emit('TIMER_READY', [GV(this.scratch)]); }
  }
  // `lit` expression nodes carry an already-evaluated value (used by compound assignment)
  const _expr = CG.prototype.expr; CG.prototype.expr = function (e) { return e.k === 'lit' ? e.v : _expr.call(this, e); };
  const _exprType = CG.prototype.exprType; CG.prototype.exprType = function (e) { return e.k === 'lit' ? e.v.t : _exprType.call(this, e); };

  /* constant expressions (array sizes, const declarations, case labels) */
  function constValue(e, S, tok, cg) {
    switch (e.k) {
      case 'lit': if (!('c' in e.v)) throw err('this argument must be a constant', tok); return e.v.c;
      case 'num': return e.v;
      case 'bool': return e.v ? 1 : 0;
      case 'var': { const v = cg ? cg.lookup(e.name) : S.globals.get(e.name); if (v && v.t === 'const') return v.c; if (e.name in CONSTS) return CONSTS[e.name]; if (e.name in FLOAT_CONSTS) return FLOAT_CONSTS[e.name]; throw err('"' + e.name + '" is not a constant', e.tok); }
      case 'un': { const x = constValue(e.e, S, tok, cg); return e.op === '-' ? -x : e.op === '!' ? (x ? 0 : 1) : e.op === '~' ? ~x : x; }
      case 'bin': { const x = constValue(e.a, S, tok, cg), y = constValue(e.b, S, tok, cg); switch (e.op) { case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return y ? x / y : 0; case '%': return y ? x % y : 0; case '<<': return x << y; case '>>': return x >> y; case '&': return x & y; case '|': return x | y; case '^': return x ^ y; default: throw err('not allowed in a constant', e.tok); } }
      default: throw err('expected a constant value', e.tok || tok);
    }
  }
  const constInt = (e, S, tok, cg) => Math.trunc(constValue(e, S, tok, cg));

  /* ------------------------------------------------------------------ the API (builtins) */
  const D = P.UI_DRAW;
  const neg = (cg, v, tok) => { if ('c' in v) return { t: v.t === 'float' ? 'float' : 'int', c: -v.c }; const ty = v.t === 'float' ? 'float' : 'int'; const t = cg.tmpOf(ty); cg.a.emit(ty === 'float' ? 'SUBF' : 'SUB32', [ty === 'float' ? LCF(0) : LC0(0), cg.operand(v, ty, tok), GV(t)]); return { t: ty, off: t }; };
  const mask = (cg, v, tok) => cg.opI8(v, tok);
  /* a motor step with a possibly negative amount: the VM wants a positive step and the direction in the speed sign */
  function stepArgs(cg, power, amount, tok) {
    if ('c' in amount) { if (amount.c < 0) return { sp: cg.opI8(neg(cg, power, tok), tok), st: cg.opI32({ t: 'int', c: -amount.c }, tok) }; return { sp: cg.opI8(power, tok), st: cg.opI32(amount, tok) }; }
    const sp = cg.tmp(1), st = cg.tmp(4); cg.a.emit('MOVE8_8', [cg.opI8(power, tok), GV(sp)]); cg.a.emit('MOVE32_32', [cg.opI32(amount, tok), GV(st)]);
    const L = cg.a.newLabel(); cg.a.jump('JR_GTEQ32', [GV(st), LC0(0)], L, 'negative amount: reverse'); cg.a.emit('SUB8', [LC0(0), GV(sp), GV(sp)]); cg.a.emit('SUB32', [LC0(0), GV(st), GV(st)]); cg.a.label(L);
    return { sp: GV(sp), st: GV(st) };
  }
  const turn2 = (cg, v, tok) => { if ('c' in v) return LC(Math.round(v.c * 2)); const t = cg.tmp(4); cg.a.emit('MUL32', [cg.opI32(v, tok), LC0(2), GV(t)]); return cg.opI16({ t: 'int', off: t }, tok); };
  function readSI(cg, port, type, mode, n, index, tok) {
    n = n || 1; const base = cg.G.alloc(4 * n, 'sensor', 'F'); const outs = []; for (let i = 0; i < n; i++) outs.push(GV(base + 4 * i));
    cg.a.emit('INPUT_DEVICE', [LC0(P.INPUT_DEVICE.READY_SI), LC0(0), cg.opI8(port, tok), LC(type), LC(mode), LC0(n), ...outs]);
    return { t: 'float', off: base + 4 * (index || 0) };
  }
  const toInt = (cg, v, tok) => cg.toType(v, 'int', tok);
  const asBool = (cg, v, cmp, k, tok) => { const t = cg.tmp(1); cg.a.emit(cmp, [cg.opF(v, tok), LCF(k), GV(t)]); return { t: 'bool', off: t }; };
  function drawText(cg, x, y, s, tok, font) {
    const xi = cg.opI16(x, tok), yi = cg.opI16(y, tok);
    cg.a.emit('UI_DRAW', [LC0(D.SELECT_FONT), LC0(font === undefined ? 1 : font)]);
    if ('c' in x && 'c' in y) cg.a.emit('UI_DRAW', [LC0(D.FILLRECT), LC0(0), LC(x.c), LC(y.c), LC(178 - x.c), LC(font === 2 ? 18 : font === 0 ? 9 : 12)], 'clear to the right edge');
    cg.a.emit('UI_DRAW', [LC0(D.TEXT), LC0(1), xi, yi, s]);
    cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]);
  }
  const mathF = sub => (cg, [v], tok) => { const t = cg.tmp(4, 'F'); cg.a.emit('MATH', [LC0(sub), cg.opF(v, tok), GV(t)]); return { t: 'float', off: t }; };
  const num = 'num';
  const BUILTINS = {
    // ---- motors
    OnFwd: { args: [num, num], ret: 'void', gen(cg, [m, p], tok) { cg.a.emit('OUTPUT_SPEED', [LC0(0), mask(cg, m, tok), cg.opI8(p, tok)]); cg.a.emit('OUTPUT_START', [LC0(0), mask(cg, m, tok)]); } },
    OnRev: { args: [num, num], ret: 'void', gen(cg, [m, p], tok) { cg.a.emit('OUTPUT_SPEED', [LC0(0), mask(cg, m, tok), cg.opI8(neg(cg, p, tok), tok)]); cg.a.emit('OUTPUT_START', [LC0(0), mask(cg, m, tok)]); } },
    Off: { args: [num], ret: 'void', gen(cg, [m], tok) { cg.a.emit('OUTPUT_STOP', [LC0(0), mask(cg, m, tok), LC0(1)], 'brake'); } },
    Coast: { args: [num], ret: 'void', gen(cg, [m], tok) { cg.a.emit('OUTPUT_STOP', [LC0(0), mask(cg, m, tok), LC0(0)], 'coast'); } },
    Float: { args: [num], ret: 'void', gen(cg, [m], tok) { cg.a.emit('OUTPUT_STOP', [LC0(0), mask(cg, m, tok), LC0(0)], 'coast'); } },
    OnFwdSync: { args: [num, num, num], ret: 'void', gen(cg, [m, p, t], tok) { cg.a.emit('OUTPUT_STEP_SYNC', [LC0(0), mask(cg, m, tok), cg.opI8(p, tok), turn2(cg, t, tok), LC0(0), LC0(0)], 'run until told otherwise'); } },
    OnRevSync: { args: [num, num, num], ret: 'void', gen(cg, [m, p, t], tok) { cg.a.emit('OUTPUT_STEP_SYNC', [LC0(0), mask(cg, m, tok), cg.opI8(neg(cg, p, tok), tok), turn2(cg, t, tok), LC0(0), LC0(0)]); } },
    RotateMotor: { args: [num, num, num], ret: 'void', gen(cg, [m, p, deg], tok) { const s = stepArgs(cg, p, deg, tok); cg.a.emit('OUTPUT_STEP_SPEED', [LC0(0), mask(cg, m, tok), s.sp, LC0(0), s.st, LC0(0), LC0(1)]); cg.a.emit('OUTPUT_READY', [LC0(0), mask(cg, m, tok)], 'wait until done'); } },
    RotateMotorEx: { args: [num, num, num, num, num, num], ret: 'void', gen(cg, [m, p, deg, turn, sync, stop], tok) {
      const s = stepArgs(cg, p, deg, tok); const brake = ('c' in stop) ? (stop.c ? 1 : 0) : null; const br = brake === null ? cg.opI8(stop, tok) : LC0(brake);
      if (!('c' in sync)) throw err('the sync argument must be true or false', tok);
      if (sync.c) cg.a.emit('OUTPUT_STEP_SYNC', [LC0(0), mask(cg, m, tok), s.sp, turn2(cg, turn, tok), s.st, br]); else cg.a.emit('OUTPUT_STEP_SPEED', [LC0(0), mask(cg, m, tok), s.sp, LC0(0), s.st, LC0(0), br]);
      cg.a.emit('OUTPUT_READY', [LC0(0), mask(cg, m, tok)], 'wait until done'); } },
    OnFwdTime: { args: [num, num, num], ret: 'void', gen(cg, [m, p, ms], tok) { cg.a.emit('OUTPUT_TIME_SPEED', [LC0(0), mask(cg, m, tok), cg.opI8(p, tok), LC0(0), cg.opI32(ms, tok), LC0(0), LC0(1)]); cg.a.emit('OUTPUT_READY', [LC0(0), mask(cg, m, tok)]); } },
    OnFwdSyncTime: { args: [num, num, num, num], ret: 'void', gen(cg, [m, p, t, ms], tok) { cg.a.emit('OUTPUT_TIME_SYNC', [LC0(0), mask(cg, m, tok), cg.opI8(p, tok), turn2(cg, t, tok), cg.opI32(ms, tok), LC0(1)]); cg.a.emit('OUTPUT_READY', [LC0(0), mask(cg, m, tok)]); } },
    MotorRotationCount: { args: [num], ret: 'int', gen(cg, [m], tok) { const t = cg.tmp(4); cg.a.emit('OUTPUT_GET_COUNT', [LC0(0), LC0(portIndexOf(m, tok)), GV(t)]); return { t: 'int', off: t }; } },
    ResetRotationCount: { args: [num], ret: 'void', gen(cg, [m], tok) { cg.a.emit('OUTPUT_CLR_COUNT', [LC0(0), mask(cg, m, tok)]); } },
    MotorPower: { args: [num], ret: 'int', gen(cg, [m], tok) { const s8 = cg.tmp(1), t32 = cg.tmp(4); cg.a.emit('OUTPUT_READ', [LC0(0), LC0(portIndexOf(m, tok)), GV(s8), GV(t32)]); return cg.toType({ t: 'bool', off: s8 }, 'int', tok); } },
    MotorRunning: { args: [num], ret: 'bool', gen(cg, [m], tok) { const t = cg.tmp(1); cg.a.emit('OUTPUT_TEST', [LC0(0), mask(cg, m, tok), GV(t)]); return { t: 'bool', off: t }; } },
    // ---- sensors (EV3 auto-detects the sensor type; the mode picks what to measure)
    SensorValue: { args: [num], ret: 'float', gen: (cg, [p], tok) => readSI(cg, p, 0, -1, 1, 0, tok) },
    SensorRaw: { args: [num, num], ret: 'float', min: 1, gen: (cg, [p, mode], tok) => readSI(cg, p, 0, mode ? constInt({ k: 'lit', v: mode }, null, tok) : -1, 1, 0, tok) },
    SetSensorMode: { args: [num, num], ret: 'void', gen(cg, [p, mode], tok) { readSI(cg, p, 0, constInt({ k: 'lit', v: mode }, null, tok), 1, 0, tok); } },
    SensorTouch: { args: [num], ret: 'bool', gen: (cg, [p], tok) => asBool(cg, readSI(cg, p, 16, 0, 1, 0, tok), 'CP_GTF', 0.5, tok) },
    SensorBumps: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 16, 1, 1, 0, tok), tok) },
    SensorLight: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 29, 0, 1, 0, tok), tok) },
    SensorAmbient: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 29, 1, 1, 0, tok), tok) },
    SensorColor: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 29, 2, 1, 0, tok), tok) },
    SensorRGB: { args: [num, num], ret: 'int', gen: (cg, [p, i], tok) => toInt(cg, readSI(cg, p, 29, 4, 3, constInt({ k: 'lit', v: i }, null, tok) & 3, tok), tok) },
    SensorUS: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 30, 0, 1, 0, tok), tok) },
    SensorUSInches: { args: [num], ret: 'float', gen: (cg, [p], tok) => readSI(cg, p, 30, 1, 1, 0, tok) },
    SensorUScm: { args: [num], ret: 'float', gen: (cg, [p], tok) => readSI(cg, p, 30, 0, 1, 0, tok) },
    SensorGyro: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 32, 0, 1, 0, tok), tok) },
    SensorGyroRate: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 32, 1, 1, 0, tok), tok) },
    ResetGyro: { args: [num], ret: 'void', gen(cg, [p], tok) { readSI(cg, p, 32, 1, 1, 0, tok); readSI(cg, p, 32, 0, 1, 0, tok); } },
    SensorIR: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 33, 0, 1, 0, tok), tok) },
    SensorIRHeading: { args: [num, num], ret: 'int', min: 1, gen: (cg, [p, ch], tok) => toInt(cg, readSI(cg, p, 33, 1, 8, 2 * (ch ? constInt({ k: 'lit', v: ch }, null, tok) & 3 : 0), tok), tok) },
    SensorIRDistance: { args: [num, num], ret: 'int', min: 1, gen: (cg, [p, ch], tok) => toInt(cg, readSI(cg, p, 33, 1, 8, 2 * (ch ? constInt({ k: 'lit', v: ch }, null, tok) & 3 : 0) + 1, tok), tok) },
    SensorIRRemote: { args: [num, num], ret: 'int', min: 1, gen: (cg, [p, ch], tok) => toInt(cg, readSI(cg, p, 33, 2, 4, ch ? constInt({ k: 'lit', v: ch }, null, tok) & 3 : 0, tok), tok) },
    SensorNXTTouch: { args: [num], ret: 'bool', gen: (cg, [p], tok) => asBool(cg, readSI(cg, p, 1, 0, 1, 0, tok), 'CP_GTF', 0.5, tok) },
    SensorNXTLight: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 2, 0, 1, 0, tok), tok) },
    SensorNXTSound: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 3, 0, 1, 0, tok), tok) },
    SensorNXTUS: { args: [num], ret: 'int', gen: (cg, [p], tok) => toInt(cg, readSI(cg, p, 5, 0, 1, 0, tok), tok) },
    SensorType: { args: [num], ret: 'int', gen(cg, [p], tok) { const ty = cg.tmp(1), mo = cg.tmp(1); cg.a.emit('INPUT_DEVICE', [LC0(P.INPUT_DEVICE.GET_TYPEMODE), LC0(0), cg.opI8(p, tok), GV(ty), GV(mo)]); return cg.toType({ t: 'bool', off: ty }, 'int', tok); } },
    // ---- timing
    Wait: { args: [num], ret: 'void', gen(cg, [ms], tok) { cg.waitMs(ms, tok); } },
    CurrentTick: { args: [], ret: 'int', gen(cg, [], tok) { const t = cg.tmp(4); cg.a.emit('TIMER_READ', [GV(t)]); return { t: 'int', off: t }; } },
    // ---- display (178 x 128 pixels, y = 0 at the top; LCD_LINE1..LCD_LINE10 are 12 pixels apart)
    TextOut: { args: [num, num, 'str', num], ret: 'void', min: 3, gen(cg, [x, y, s, font], tok) { drawText(cg, x, y, cg.opStr(s, tok), tok, font ? constInt({ k: 'lit', v: font }, null, tok) : 1); } },
    NumOut: { args: [num, num, num, num], ret: 'void', min: 3, gen(cg, [x, y, v, dec], tok) {
      const d = dec ? constInt({ k: 'lit', v: dec }, null, tok) : 0; const xi = cg.opI16(x, tok), yi = cg.opI16(y, tok);
      cg.a.emit('UI_DRAW', [LC0(D.SELECT_FONT), LC0(1)]);
      if ('c' in x && 'c' in y) cg.a.emit('UI_DRAW', [LC0(D.FILLRECT), LC0(0), LC(x.c), LC(y.c), LC(178 - x.c), LC(12)], 'clear to the right edge');
      cg.a.emit('UI_DRAW', [LC0(D.VALUE), LC0(1), xi, yi, cg.opF(v, tok), LC0(1), LC0(d)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    ClearScreen: { args: [], ret: 'void', gen(cg) { cg.a.emit('UI_DRAW', [LC0(D.FILLWINDOW), LC0(0), LC0(0), LC0(0)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    ClearLine: { args: [num], ret: 'void', gen(cg, [y], tok) { cg.a.emit('UI_DRAW', [LC0(D.FILLRECT), LC0(0), LC0(0), cg.opI16(y, tok), LC(178), LC(12)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    PointOut: { args: [num, num], ret: 'void', gen(cg, [x, y], tok) { cg.a.emit('UI_DRAW', [LC0(D.PIXEL), LC0(1), cg.opI16(x, tok), cg.opI16(y, tok)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    LineOut: { args: [num, num, num, num], ret: 'void', gen(cg, [x1, y1, x2, y2], tok) { cg.a.emit('UI_DRAW', [LC0(D.LINE), LC0(1), cg.opI16(x1, tok), cg.opI16(y1, tok), cg.opI16(x2, tok), cg.opI16(y2, tok)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    RectOut: { args: [num, num, num, num, 'bool'], ret: 'void', min: 4, gen(cg, [x, y, w, h, fill], tok) { cg.a.emit('UI_DRAW', [LC0(fill && 'c' in fill && fill.c ? D.FILLRECT : D.RECT), LC0(1), cg.opI16(x, tok), cg.opI16(y, tok), cg.opI16(w, tok), cg.opI16(h, tok)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    CircleOut: { args: [num, num, num, 'bool'], ret: 'void', min: 3, gen(cg, [x, y, r, fill], tok) { cg.a.emit('UI_DRAW', [LC0(fill && 'c' in fill && fill.c ? D.FILLCIRCLE : D.CIRCLE), LC0(1), cg.opI16(x, tok), cg.opI16(y, tok), cg.opI16(r, tok)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    GraphicOut: { args: [num, num, 'str'], ret: 'void', gen(cg, [x, y, f], tok) { cg.a.emit('UI_DRAW', [LC0(D.BMPFILE), LC0(1), cg.opI16(x, tok), cg.opI16(y, tok), cg.opStr(f, tok)]); cg.a.emit('UI_DRAW', [LC0(D.UPDATE)]); } },
    // ---- sound
    PlayTone: { args: [num, num], ret: 'void', gen(cg, [hz, ms], tok) { cg.a.emit('SOUND', [LC0(P.SOUND.TONE), LC(50), cg.opI16(hz, tok), cg.opI16(ms, tok)]); } },
    PlayToneEx: { args: [num, num, num], ret: 'void', gen(cg, [hz, ms, vol], tok) { cg.a.emit('SOUND', [LC0(P.SOUND.TONE), cg.opI8(vol, tok), cg.opI16(hz, tok), cg.opI16(ms, tok)]); } },
    PlayFile: { args: ['str'], ret: 'void', gen(cg, [f], tok) { cg.a.emit('SOUND', [LC0(P.SOUND.PLAY), LC(50), cg.opStr(f, tok)]); } },
    PlayFileEx: { args: ['str', num, 'bool'], ret: 'void', gen(cg, [f, vol, loop], tok) { cg.a.emit('SOUND', [LC0(loop && 'c' in loop && loop.c ? P.SOUND.REPEAT : P.SOUND.PLAY), cg.opI8(vol, tok), cg.opStr(f, tok)]); } },
    SoundReady: { args: [], ret: 'void', gen(cg) { cg.a.emit('SOUND_READY', [], 'wait for the sound to finish'); } },
    StopSound: { args: [], ret: 'void', gen(cg) { cg.a.emit('SOUND', [LC0(P.SOUND.BREAK)]); } },
    SetVolume: { args: [num], ret: 'void', gen(cg, [v], tok) { cg.a.emit('INFO', [LC0(P.INFO.SET_VOLUME), cg.opI8(v, tok)]); } },
    // ---- brick
    SetLED: { args: [num], ret: 'void', gen(cg, [p], tok) { cg.a.emit('UI_WRITE', [LC0(P.UI_WRITE.LED), cg.opI8(p, tok)]); } },
    ButtonPressed: { args: [num], ret: 'bool', gen(cg, [b], tok) { const t = cg.tmp(1); cg.a.emit('UI_BUTTON', [LC0(P.UI_BUTTON.PRESSED), cg.opI8(b, tok), GV(t)]); return { t: 'bool', off: t }; } },
    BatteryLevel: { args: [], ret: 'float', gen(cg) { const t = cg.tmp(4, 'F'); cg.a.emit('UI_READ', [LC0(P.UI_READ.GET_VBATT), GV(t)]); return { t: 'float', off: t }; } },
    BatteryPercent: { args: [], ret: 'int', gen(cg, [], tok) { const t = cg.tmp(1); cg.a.emit('UI_READ', [LC0(P.UI_READ.GET_LBATT), GV(t)]); return cg.toType({ t: 'bool', off: t }, 'int', tok); } },
    KeepAlive: { args: [], ret: 'void', gen(cg) { const t = cg.tmp(1); cg.a.emit('KEEP_ALIVE', [GV(t)]); } },
    Random: { args: [num, num], ret: 'int', min: 1, gen(cg, [a, b], tok) {
      const t16 = cg.tmp(2), t = cg.tmp(4);
      const lo = b ? cg.opI16(a, tok) : LC0(0); let hi; if (b) hi = cg.opI16(b, tok); else if ('c' in a) hi = LC(Math.trunc(a.c) - 1); else { const h = cg.tmp(2); cg.a.emit('SUB16', [cg.opI16(a, tok), LC0(1), GV(h)]); hi = GV(h); }
      cg.a.emit('RANDOM', [lo, hi, GV(t16)]); cg.a.emit('MOVE16_32', [GV(t16), GV(t)]); return { t: 'int', off: t }; } },
    Stop: { args: [], ret: 'void', gen(cg) { cg.a.emit('OUTPUT_STOP', [LC0(0), LC0(15), LC0(0)]); cg.a.emit('OBJECT_END', [], 'stop this task'); } },
    StopAllTasks: { args: [], ret: 'void', gen(cg) { cg.a.emit('OUTPUT_STOP', [LC0(0), LC0(15), LC0(0)]); cg.a.emit('PROGRAM_STOP', [LC0(P.USER_SLOT)], 'stop the whole program'); cg.a.emit('OBJECT_END', []); } },
    // ---- maths (angles in degrees, results are floats)
    abs: { args: [num], ret: num, gen(cg, [v], tok) { if ('c' in v) return { t: v.t === 'float' ? 'float' : 'int', c: Math.abs(v.c) }; if (v.t === 'float') return mathF(P.MATH.ABS)(cg, [v], tok); const t = cg.tmp(4); cg.a.emit('MOVE32_32', [cg.opI32(v, tok), GV(t)]); const L = cg.a.newLabel(); cg.a.jump('JR_GTEQ32', [GV(t), LC0(0)], L); cg.a.emit('SUB32', [LC0(0), GV(t), GV(t)]); cg.a.label(L); return { t: 'int', off: t }; } },
    sqrt: { args: [num], ret: 'float', gen: mathF(P.MATH.SQRT) }, sin: { args: [num], ret: 'float', gen: mathF(P.MATH.SIN) }, cos: { args: [num], ret: 'float', gen: mathF(P.MATH.COS) }, tan: { args: [num], ret: 'float', gen: mathF(P.MATH.TAN) },
    asin: { args: [num], ret: 'float', gen: mathF(P.MATH.ASIN) }, acos: { args: [num], ret: 'float', gen: mathF(P.MATH.ACOS) }, atan: { args: [num], ret: 'float', gen: mathF(P.MATH.ATAN) },
    exp: { args: [num], ret: 'float', gen: mathF(P.MATH.EXP) }, log: { args: [num], ret: 'float', gen: mathF(P.MATH.LN) }, log10: { args: [num], ret: 'float', gen: mathF(P.MATH.LOG) },
    floor: { args: [num], ret: 'float', gen: mathF(P.MATH.FLOOR) }, ceil: { args: [num], ret: 'float', gen: mathF(P.MATH.CEIL) }, round: { args: [num], ret: 'float', gen: mathF(P.MATH.ROUND) }, trunc: { args: [num], ret: 'float', gen: mathF(P.MATH.TRUNC) },
    pow: { args: [num, num], ret: 'float', gen(cg, [a, b], tok) { const t = cg.tmp(4, 'F'); cg.a.emit('MATH', [LC0(P.MATH.POW), cg.opF(a, tok), cg.opF(b, tok), GV(t)]); return { t: 'float', off: t }; } },
    min: { args: [num, num], ret: num, gen(cg, [a, b], tok) { return minmax(cg, a, b, 'JR_LTEQ', tok); } },
    max: { args: [num, num], ret: num, gen(cg, [a, b], tok) { return minmax(cg, a, b, 'JR_GTEQ', tok); } },
    // ---- strings
    NumToStr: { args: [num, num], ret: 'str', min: 1, gen(cg, [v, dec], tok) { const t = cg.G.alloc(33, 'numstr'); const d = dec ? constInt({ k: 'lit', v: dec }, null, tok) : (v.t === 'float' ? 2 : 0); cg.a.emit('STRINGS', [LC0(5), cg.opF(v, tok), LC0(1), LC0(d), GV(t)], 'number to text'); return { t: 'str', off: t, size: 33 }; } },
    StrLen: { args: ['str'], ret: 'int', gen(cg, [s], tok) { const t = cg.tmp(1); cg.a.emit('STRINGS', [LC0(1), cg.opStr(s, tok), GV(t)]); return cg.toType({ t: 'bool', off: t }, 'int', tok); } },
    // ---- Bluetooth mailboxes (to another EV3 or a PC that writes mailboxes)
    SendMessage: { args: ['str', 'str'], ret: 'void', gen(cg, [box, s], tok) { if (!('c' in box)) throw err('the mailbox name must be text in quotes', tok); const h = cg.tmp(1); cg.a.emit('MAILBOX_OPEN', [LC0(0), LCS(box.c), LC0(4), LC0(0), LC0(0), GV(h)]); cg.a.emit('MAILBOX_WRITE', [LCS(''), LC0(0), LCS(box.c), LC0(4), LC0(1), cg.opStr(s, tok)]); } },
    ReceiveMessage: { args: ['str'], ret: 'str', gen(cg, [box], tok) { if (!('c' in box)) throw err('the mailbox name must be text in quotes', tok); const h = cg.tmp(1), t = cg.G.alloc(65, 'mailbox'); cg.a.emit('MAILBOX_OPEN', [LC0(0), LCS(box.c), LC0(4), LC0(0), LC0(0), GV(h)]); cg.a.emit('MAILBOX_READ', [GV(h), LC(64), LC0(1), GV(t)]); return { t: 'str', off: t, size: 65 }; } },
    // ---- data logging to a file on the brick (../prjs/<name>.rtf, readable from the Files view)
    LogOpen: { args: ['str'], ret: 'void', gen(cg, [f], tok) { if (!('c' in f)) throw err('the file name must be text in quotes', tok); const h = cg.S.logHandle || (cg.S.logHandle = cg.G.alloc(2, 'log')); cg.a.emit('FILE', [LC0(P.FILE.OPEN_WRITE), LCS(f.c), GV(h)]); } },
    LogWrite: { args: ['str'], ret: 'void', gen(cg, [s], tok) { if (!cg.S.logHandle) throw err('call LogOpen first', tok); cg.a.emit('FILE', [LC0(P.FILE.WRITE_TEXT), GV(cg.S.logHandle), LC0(0), cg.opStr(s, tok)]); } },
    LogWriteLine: { args: ['str'], ret: 'void', gen(cg, [s], tok) { if (!cg.S.logHandle) throw err('call LogOpen first', tok); cg.a.emit('FILE', [LC0(P.FILE.WRITE_TEXT), GV(cg.S.logHandle), LC0(6), cg.opStr(s, tok)], 'with newline'); } },
    LogClose: { args: [], ret: 'void', gen(cg, [], tok) { if (!cg.S.logHandle) throw err('call LogOpen first', tok); cg.a.emit('FILE', [LC0(P.FILE.CLOSE), GV(cg.S.logHandle)]); } },
  };
  Object.values(BUILTINS).forEach(b => { if (b.min === undefined) b.min = b.args.length; });
  function minmax(cg, a, b, jr, tok) {
    const fl = a.t === 'float' || b.t === 'float'; if ('c' in a && 'c' in b) return { t: fl ? 'float' : 'int', c: jr === 'JR_LTEQ' ? Math.min(a.c, b.c) : Math.max(a.c, b.c) };
    const ty = fl ? 'float' : 'int'; const t = cg.tmpOf(ty); const pa = cg.operand(a, ty, tok), pb = cg.operand(b, ty, tok); const L = cg.a.newLabel(), Lend = cg.a.newLabel();
    cg.a.jump(jr + (fl ? 'F' : '32'), [pa, pb], L); cg.store({ t: ty, off: t }, b, tok); cg.a.jump('JR', [], Lend); cg.a.label(L); cg.store({ t: ty, off: t }, a, tok); cg.a.label(Lend); return { t: ty, off: t };
  }

  /* ------------------------------------------------------------------ compile */
  function compile(source) {
    const prog = parse(tokenize(source));
    const main = prog.tasks.find(t => t.name === 'main');
    if (!main) throw new EVCError('every program needs "task main() { ... }"', prog.tasks[0] ? prog.tasks[0].tok.line : 1, 1);
    const G = new A.Globals();
    const S = { funcs: {}, taskIndex: {}, globals: new Map(), usesThreads: false, logHandle: null };
    S.scratch = G.alloc(4, 'scratch');
    for (const f of prog.funcs) { if (S.funcs[f.name]) throw err('function "' + f.name + '" is defined twice', f.tok); if (BUILTINS[f.name]) throw err('"' + f.name + '" is already a built-in function', f.tok); S.funcs[f.name] = f; }
    const tasks = [main, ...prog.tasks.filter(t => t !== main)];
    tasks.forEach((t, i) => { if (S.taskIndex[t.name] !== undefined) throw err('task "' + t.name + '" is defined twice', t.tok); S.taskIndex[t.name] = i + 1; });
    const mainCG = new CG(G, S, 'main');
    // globals: constants and variables (initialisers run at the start of main)
    for (const d of prog.globals) {
      if (d.isConst) { S.globals.set(d.name, { t: 'const', ct: d.type === 'float' ? 'float' : d.type === 'bool' ? 'bool' : 'int', c: constValue(d.init, S, d.tok, mainCG) }); continue; }
      if (S.globals.has(d.name)) throw err('"' + d.name + '" is declared twice', d.tok);
      const v = mainCG.declare(d);
      if (d.init) { if (v.t === 'array') throw err('arrays cannot be initialised yet; assign the elements', d.tok); const m = mainCG.mark(); mainCG.store(v, mainCG.expr(d.init), d.tok); mainCG.release(m); }
    }
    mainCG.stmt(main.body); mainCG.a.emit('OBJECT_END', [], 'end of program');
    const threadCGs = tasks.slice(1).map(t => { const cg = new CG(G, S, t.name); cg.stmt(t.body); cg.a.emit('OBJECT_END', []); return cg; });
    const mainCode = mainCG.a.finish();
    const threads = [[mainCode, 0], ...threadCGs.map(cg => [cg.a.finish(), 0])];
    const globals = G.aligned;
    const listing = A.listing(G, [{ name: 'MAIN', asm: mainCG.a }, ...threadCGs.map(cg => ({ name: cg.name, asm: cg.a }))]);
    return { main: mainCode, direct: mainCode, threads, globals, locals: 0, rbf: P.rbfImage(threads, globals), listing, tasks: tasks.map(t => t.name), usesThreads: S.usesThreads };
  }

  /* ------------------------------------------------------------------ assembler (the listing syntax)
   *   DATA8 name | DATA16 name | DATA32 name | DATAF name | DATAS name size      declarations, in order
   *   vmthread NAME { ... }        the first (or the one called MAIN) is the main thread
   *   label:                       jump targets
   *   OPCODE(p1, p2, ...)          numbers (12, -3, 2.5), "text", variable names, sub-code names
   *                                (UI_DRAW(TEXT, ...)), labels as the last parameter of JR* opcodes,
   *                                thread names in OBJECT_START / OBJECT_STOP
   *   ; comment   // comment */
  function assemble(text) {
    const G = new A.Globals(); const vars = {}; const threads = []; let cur = null;
    const lines = text.split('\n');
    const fail = (msg, ln) => { throw new EVCError(msg, ln, 1); };
    // thread names first, so OBJECT_START can refer to later threads
    const threadNames = []; lines.forEach(l => { const m = /^\s*vmthread\s+([A-Za-z_]\w*)\s*\{/.exec(l); if (m) threadNames.push(m[1]); });
    const orderedNames = threadNames.includes('MAIN') ? ['MAIN', ...threadNames.filter(n => n !== 'MAIN')] : threadNames;
    const threadNo = name => { const i = orderedNames.indexOf(name); return i < 0 ? null : i + 1; };
    lines.forEach((raw, idx) => {
      const ln = idx + 1; let line = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '').trim();
      if (!line) return;
      let m;
      if ((m = /^(DATA8|DATA16|DATA32|DATAF|DATAS)\s+([A-Za-z_]\w*)(?:\s+(\d+))?$/.exec(line))) {
        const bytes = { DATA8: 1, DATA16: 2, DATA32: 4, DATAF: 4 }[m[1]] || Number(m[3]); if (!bytes) fail('DATAS needs a size', ln);
        if (vars[m[2]]) fail('"' + m[2] + '" declared twice', ln);
        vars[m[2]] = G.alloc(bytes, m[2], m[1] === 'DATAF' ? 'F' : null); return;
      }
      if ((m = /^vmthread\s+([A-Za-z_]\w*)\s*\{$/.exec(line))) { if (cur) fail('vmthread inside vmthread', ln); cur = { name: m[1], asm: new A.Asm(G) }; return; }
      if (line === '}') { if (!cur) fail('unexpected }', ln); if (cur.asm.lastOp !== 'OBJECT_END') cur.asm.emit('OBJECT_END', []); threads.push(cur); cur = null; return; }
      if (!cur) fail('instructions must be inside a vmthread { } block', ln);
      if ((m = /^([A-Za-z_]\w*):$/.exec(line))) { cur.asm.label(m[1]); return; }
      m = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(line); if (!m) fail('cannot read this line', ln);
      const op = m[1]; if (!(op in P.OP)) fail('unknown opcode ' + op, ln);
      const args = []; { let s = m[2], i = 0, depth = 0, start = 0, q = false; for (; i < s.length; i++) { const ch = s[i]; if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; } else if (ch === '"') q = true; else if (ch === ',' && depth === 0) { args.push(s.slice(start, i).trim()); start = i + 1; } } const last = s.slice(start).trim(); if (last || args.length) args.push(last); }
      const isJump = /^JR/.test(op); const params = []; let label = null;
      args.forEach((a, i) => {
        if (isJump && i === args.length - 1) { if (!/^[A-Za-z_]\w*$/.test(a)) fail('the last parameter of ' + op + ' must be a label', ln); label = a; return; }
        if (/^"/.test(a)) { try { params.push(LCS(JSON.parse(a))); } catch (e) { fail('bad string ' + a, ln); } return; }
        if ((op === 'OBJECT_START' || op === 'OBJECT_STOP' || op === 'OBJECT_WAIT' || op === 'OBJECT_TRIG') && i === 0 && (threadNo(a) !== null || /^\d+$/.test(a))) { params.push(LC2(threadNo(a) !== null ? threadNo(a) : Number(a))); return; }
        if (/^[-+]?\d+$/.test(a)) { params.push(LC(Number(a))); return; }
        if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(a)) { params.push(LCF(Number(a))); return; }
        if (a in vars) { params.push(GV(vars[a])); return; }
        if (i === 0 && A.SUBCODES[op] && a in A.SUBCODES[op]) { params.push(LC0(A.SUBCODES[op][a])); return; }
        if (a in CONSTS) { params.push(LC(CONSTS[a])); return; }
        fail('unknown name "' + a + '"' + (/^[A-Za-z_]\w*$/.test(a) ? ' (declare it with DATA32 ' + a + ' or similar)' : ''), ln);
      });
      try { if (isJump) cur.asm.jump(op, params, label); else cur.asm.emit(op, params); } catch (e) { fail(e.message, ln); }
    });
    if (cur) fail('missing } at the end of vmthread ' + cur.name, lines.length);
    if (!threads.length) fail('no vmthread found; wrap the code in vmthread MAIN { ... }', 1);
    const mi = Math.max(0, threads.findIndex(t => t.name === 'MAIN')); const ordered = [threads[mi], ...threads.filter((t, i) => i !== mi)];
    let codes; try { codes = ordered.map(t => t.asm.finish()); } catch (e) { fail(e.message, lines.length); }
    const ths = codes.map(c => [c, 0]); const globals = G.aligned;
    return { main: codes[0], direct: codes[0], threads: ths, globals, locals: 0, rbf: P.rbfImage(ths, globals), listing: A.listing(G, ordered), tasks: ordered.map(t => t.name), usesThreads: ths.length > 1 };
  }

  ns.evc = { compile, assemble, tokenize, parse, EVCError, CONSTS, BUILTINS };
})(OpenEV3);
