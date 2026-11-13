/* EVC compiler + assembler tests, run by run.js inside the same VM context. */
module.exports = function (ctx, test, assert, eq) {
  const { protocol: P, vm: V, evc: E } = ctx.OpenEV3;
  // run a compiled program's main thread on a fresh simulated brick and return the brick state
  async function runMain(src, setup) {
    const c = E.compile(src); const b = new V.BrickState(); if (setup) setup(b, c);
    const m = new V.VM(b, c.globals, 0, c.main); await m.run(500000); return { b, m, c };
  }
  const g32 = (r, name) => { const e = r.c.listingVars ? null : null; return e; };

  test('evc: tokens, expressions and constant folding', async () => {
    const { b, m, c } = await runMain(`
      #define SPEED 50
      const int LINE = LCD_LINE2;
      int x = 7, y = 3; float f = 2.5; bool ok;
      task main() {
        x = x * 2 + y % 2 - (y << 1);        // 14 + 1 - 6 = 9
        f = f * x / 2;                       // 11.25
        ok = x > 8 && !(f < 10.0) || false;
        NumOut(0, LINE, x); NumOut(0, LCD_LINE3, f, 2); NumOut(0, LCD_LINE4, ok);
        NumOut(0, LCD_LINE5, SPEED + 0x10); NumOut(0, LCD_LINE6, -x);
        int q = 17 / 5; NumOut(0, LCD_LINE7, q); NumOut(0, LCD_LINE8, 17.0 / 5, 1);
      }`);
    eq(b.display, ['(0,12) 9', '(0,24) 11.25', '(0,36) 1', '(0,48) 66', '(0,60) -9', '(0,72) 3', '(0,84) 3.4']);
    assert.ok(c.listing.includes('vmthread MAIN {') && c.listing.includes('DATA32 x') && c.listing.includes('DATAF f'));
  });

  test('evc: control flow (if, while, for, repeat, until, switch, break, continue)', async () => {
    const { b } = await runMain(`
      task main() {
        int sum = 0, i;
        for (i = 1; i <= 10; i++) { if (i == 5) continue; if (i > 8) break; sum += i; }   // 1+2+3+4+6+7+8 = 31
        NumOut(0, LCD_LINE1, sum);
        int n = 0; while (n < 3) n++; NumOut(0, LCD_LINE2, n);
        int r = 0; repeat (4) { r += 2; } NumOut(0, LCD_LINE3, r);
        int d = 0; do { d++; } while (d < 2); NumOut(0, LCD_LINE4, d);
        int k = 0; until (k >= 2) { k++; } NumOut(0, LCD_LINE5, k);
        switch (sum) { case 30: TextOut(0, LCD_LINE6, "thirty"); break; case 31: TextOut(0, LCD_LINE6, "thirty-one"); break; default: TextOut(0, LCD_LINE6, "other"); }
        if (sum > 100) TextOut(0, LCD_LINE7, "big"); else if (sum > 20) TextOut(0, LCD_LINE7, "medium"); else TextOut(0, LCD_LINE7, "small");
      }`);
    eq(b.display, ['(0,0) 31', '(0,12) 3', '(0,24) 8', '(0,36) 2', '(0,48) 2', '(0,60) thirty-one', '(0,72) medium']);
  });

  test('evc: functions with parameters and return values are inlined', async () => {
    const { b, c } = await runMain(`
      int twice(int v) { return v * 2; }
      float avg(float a, float b) { return (a + b) / 2; }
      sub beep(int n) { repeat (n) { PlayTone(440, 100); Wait(10); } }
      bool big(int v) { if (v > 10) return true; return false; }
      task main() { beep(3); NumOut(0, LCD_LINE1, twice(21)); NumOut(0, LCD_LINE2, avg(1, 2), 1); NumOut(0, LCD_LINE3, big(twice(6))); }`);
    eq(b.display, ['(0,0) 42', '(0,12) 1.5', '(0,24) 1']); assert.strictEqual(b.sounds.length, 3);
    assert.throws(() => E.compile('int f(int n) { return f(n - 1); } task main() { f(3); }'), /calls itself/);
  });

  test('evc: motors, sensors, until and the API', async () => {
    const { b } = await runMain(`
      task main() {
        OnFwd(OUT_BC, 50); Wait(100); Off(OUT_BC);
        RotateMotor(OUT_A, 75, 360); RotateMotor(OUT_A, 75, -90);
        int deg = -180; RotateMotor(OUT_B, 60, deg);
        OnFwdSync(OUT_BC, 40, 25);
        until (SensorTouch(S1)); Off(OUT_BC);
        NumOut(0, LCD_LINE1, SensorUS(S4)); NumOut(0, LCD_LINE2, MotorRotationCount(OUT_A));
        if (SensorColor(S3) == COLOR_RED) SetLED(LED_RED_FLASH);
        NumOut(0, LCD_LINE3, SENSOR_2, 1);
      }`, b => { b.inputs[0] = { type: 16, mode: 0, values: [1] }; b.inputs[1] = { type: 29, mode: 0, values: [42.5] }; b.inputs[2] = { type: 29, mode: 2, values: [5] }; b.inputs[3] = { type: 30, mode: 0, values: [33] }; });
    assert.strictEqual(b.motors[0].tacho, 270); assert.strictEqual(b.motors[1].tacho, -180); assert.strictEqual(b.led, 5);
    eq(b.display, ['(0,0) 33', '(0,12) 270', '(0,24) 42.5']);
    assert.ok(b.log.some(l => /STEP_SYNC 6 speed 40 turn 50/.test(l)));
  });

  test('evc: arrays, strings and data logging', async () => {
    const { b } = await runMain(`
      int a[5]; string name = "EV3";
      task main() {
        int i; for (i = 0; i < 5; i++) a[i] = i * i;
        int s = 0; for (i = 0; i < 5; i++) s += a[i];
        NumOut(0, LCD_LINE1, s); NumOut(0, LCD_LINE2, a[3]);
        string msg = "Hi " + name; TextOut(0, LCD_LINE3, msg); NumOut(0, LCD_LINE4, StrLen(msg));
        if (name == "EV3") TextOut(0, LCD_LINE5, "match");
        LogOpen("../prjs/test.rtf"); LogWriteLine("sum=" + NumToStr(s)); LogClose();
      }`);
    eq(b.display, ['(0,0) 30', '(0,12) 9', '(0,24) Hi EV3', '(0,36) 6', '(0,48) match']);
    assert.strictEqual(new TextDecoder().decode(b.files['../prjs/test.rtf']), 'sum=30\n');
    assert.throws(() => E.compile('int a[3]; task main() { a[3] = 1; }'), /outside the array/);
  });

  test('evc: tasks become VM threads; start emits OBJECT_START', async () => {
    const c = E.compile('task blink() { SetLED(LED_RED); Wait(100); SetLED(LED_GREEN); } task main() { start blink; Wait(500); stop blink; }');
    assert.strictEqual(c.threads.length, 2); eq(c.tasks, ['main', 'blink']); assert.ok(c.usesThreads);
    assert.ok(c.listing.includes('OBJECT_START(2)') && c.listing.includes('vmthread blink {'));
    const b = new V.BrickState(); const m = new V.VM(b, c.globals, 0, c.threads[1][0]); await m.run(); assert.strictEqual(b.led, 1);
    assert.strictEqual(c.rbf.length, 16 + 12 * 2 + c.threads[0][0].length + c.threads[1][0].length);
  });

  test('evc: error messages carry line numbers', () => {
    const bad = [['task main() { int x = ; }', 1, /expected a value/], ['task main() {\n  Foo(1);\n}', 2, /unknown function "Foo"/], ['task main() { x = 1; }', 1, /not declared/],
      ['task main() { OnFwd(OUT_A); }', 1, /takes 2 arguments/], ['int main() { }', 1, /task main/], ['task main() { break; }', 1, /outside a loop/], ['task main() { int x = 1\n int y; }', 2, /";"/]];
    for (const [src, line, re] of bad) { let e = null; try { E.compile(src); } catch (x) { e = x; } assert.ok(e && re.test(e.message), src + ' -> ' + (e && e.message)); assert.strictEqual(e.line, line, src); }
  });

  test('assembler: listing round-trips to the same bytes, and hand-written assembly runs', async () => {
    const c = E.compile(`int a[3]; task t2() { PlayTone(440, 100); } task main() { int i = 2; a[i] = 5; float f = 1.5; if (f > 1 && SensorTouch(S1)) { TextOut(2, LCD_LINE1, "hi \\"there\\""); } start t2; repeat (3) { RotateMotor(OUT_A, 50, 90); } }`);
    const r = E.assemble(c.listing);
    assert.strictEqual(r.threads.length, 2); eq(Array.from(r.main), Array.from(c.main)); eq(Array.from(r.threads[1][0]), Array.from(c.threads[1][0])); assert.strictEqual(r.globals, c.globals);
    const hand = E.assemble(`DATA32 count\nDATAF v\nvmthread MAIN {\n  MOVE8_32(0, count)\nloop:\n  ADD32(count, 1, count)\n  JR_LT32(count, 4, loop)\n  MOVE32_F(count, v)\n  DIVF(v, 8.0, v)\n  UI_DRAW(VALUE, 1, 0, 0, v, 1, 2)\n  SOUND(TONE, 50, 880, 100)\n}`);
    const b = new V.BrickState(); const m = new V.VM(b, hand.globals, 0, hand.main); await m.run(); eq(b.display, ['(0,0) 0.50']); assert.strictEqual(b.sounds[0].tone, 880);
    assert.throws(() => E.assemble('vmthread MAIN {\n  FOO(1)\n}'), /unknown opcode FOO/);
    assert.throws(() => E.assemble('vmthread MAIN {\n  ADD32(x, 1, x)\n}'), /unknown name "x"/);
  });
};
