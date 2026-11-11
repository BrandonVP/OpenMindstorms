/* Node tests for the OpenEV3 browser core.  Run:  node web/ev3/tests/run.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder, Uint8Array, DataView, Map, Set, Promise, Date, Math, Number, String, Object, Array, Error, JSON, RegExp, performance });
for (const f of ['protocol.js', 'vm.js', 'ev3.js', 'transports.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const { protocol: P, vm: V, EV3, sim: S } = ctx.OpenEV3;
const tests = []; const test = (n, f) => tests.push({ n, f });
const eq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const { LC, LC0, LC1, LC2, LCS, GV, op } = P;

test('encoding and framing', () => {
  eq(LC0(5), [5]); eq(LC0(-1), [0x3f]); eq(LC1(-50), [0x81, 0xce]); eq(LC2(440), [0x82, 0xb8, 1]); eq(LC(32), [0x81, 0x20]); eq(LC(1000), [0x82, 0xe8, 3]);
  eq(LCS('hi'), [0x84, 0x68, 0x69, 0]); eq(GV(3), [0x63]); eq(GV(40), [0xe1, 40]);
  const msg = P.directCommand(op('SOUND', LC0(1), LC1(50), LC2(440), LC2(300)), 0, 0, 7, false);
  eq(Array.from(msg.subarray(0, 7)), [msg.length - 2, 0, 7, 0, 0x80, 0, 0]);
  const m = P.parseMessage(Uint8Array.from([7, 0, 5, 0, 2, 1, 2, 3, 4])); assert.strictEqual(m.counter, 5); assert.strictEqual(m.type, 2); eq(Array.from(m.rest), [1, 2, 3, 4]);
  const img = P.rbfImage([[Uint8Array.from([1, 0x0a]), 0]], 4); assert.strictEqual(new TextDecoder().decode(img.subarray(0, 4)), 'LEGO'); assert.strictEqual(img.length, 30);
  const lst = P.parseFileListing('0123456789abcdef0123456789abcdef 0000012C Program.rbf\nSD_Card/\n./\n'); assert.strictEqual(lst.length, 2); assert.strictEqual(lst[0].size, 300); assert.strictEqual(lst[1].dir, true);
});

test('vm arithmetic, jumps, floats', async () => {
  const code = Uint8Array.from([...op('MOVE8_32', LC0(5), GV(0)), ...op('ADD32', GV(0), LC0(3), GV(0)), ...op('JR_LT32', GV(0), LC0(20), LC0(-8)), ...op('CP_EQ32', GV(0), LC0(20), GV(4))]);
  const m = new V.VM(new V.BrickState(), 5, 0, code); await m.run();
  assert.strictEqual(m.gv.getInt32(0, true), 20); assert.strictEqual(m.g[4], 1); assert.strictEqual(m.steps, 12);
  const b = new V.BrickState();
  const m2 = new V.VM(b, 8, 0, Uint8Array.from([...op('MOVE8_F', LC0(7), GV(0)), ...op('DIVF', GV(0), LC(2), GV(4)), ...op('UI_DRAW', LC0(P.UI_DRAW.VALUE), LC0(1), LC0(0), LC0(0), GV(4), LC0(3), LC0(1))]));
  await m2.run(); assert.strictEqual(m2.gv.getFloat32(4, true), 3.5); eq(b.display, ['(0,0) 3.5']);
  await assert.rejects(() => new V.VM(new V.BrickState(), 0, 0, Uint8Array.from([0xfe])).run(), /unsupported opcode/);
});

test('brick api against the simulator', async () => {
  const t = new S.SimTransport(); const ev3 = new EV3(t); const s = t.ev3.state;
  const i = await ev3.info(); assert.strictEqual(i.name, 'EV3'); assert.strictEqual(i.firmware, 'V1.09H'); assert.strictEqual(i.batteryPct, 95);
  await ev3.setName('Robbie'); assert.strictEqual(await ev3.name(), 'Robbie');
  await ev3.setVolume(80); assert.strictEqual(await ev3.volume(), 80);
  await ev3.playTone(440, 250, 30); await ev3.led('red_flash'); await ev3.displayText(['hello', 'world']);
  eq(s.sounds[0], { tone: 440, ms: 250, vol: 30 }); assert.strictEqual(s.led, 5); eq(s.display, ['(2,2) hello', '(2,14) world']);
  s.inputs[0] = { type: 16, mode: 0, values: [1] }; s.inputs[3] = { type: 30, mode: 0, values: [42.5] };
  const devs = await ev3.devices(); eq(devs.map(d => d.typeName), ['touch', 'none', 'none', 'ultrasonic', 'large-motor', 'large-motor', 'large-motor', 'none']);
  assert.strictEqual(await ev3.sensorValue(1), 1); assert.strictEqual(await ev3.sensorValue(4, 0), 42.5);
  s.inputs[1] = { type: 29, mode: 0, values: [3, 4, 5] }; eq(await ev3.sensorRead(2, 4, 3), [3, 4, 5]);
  await ev3.motorSpeed('B', 60); assert.strictEqual(s.motors[1].running, true);
  await ev3.motorDegrees('C', 50, 360); assert.strictEqual(s.motors[2].tacho, 360);
  await ev3.motorDegrees('C', 50, -90, true, true); assert.strictEqual(await ev3.motorPosition('C'), 270);
  await ev3.drive('BC', 50, 50, 720); assert.strictEqual(s.motors[1].tacho, 720);
  await ev3.motorStop('ABCD'); assert.strictEqual(s.motors[1].running, false);
  await ev3.motorReset('C'); assert.strictEqual(await ev3.motorPosition('C'), 0);
  eq(await ev3.motorState('B'), { speed: 0, tacho: 720 });
  s.buttons.enter = true; const btn = await ev3.buttons(); assert.strictEqual(btn.enter, true); assert.strictEqual(btn.up, false);
});

test('files and programs', async () => {
  const t = new S.SimTransport(); const ev3 = new EV3(t); const s = t.ev3.state;
  const data = new Uint8Array(2560); for (let i = 0; i < data.length; i++) data[i] = i & 0xFF;
  let last = 0; await ev3.upload('OpenEV3/test.rbf', data, p => { last = p; });
  assert.strictEqual(last, 2560); eq(Array.from(s.files['../prjs/OpenEV3/test.rbf']), Array.from(data));
  const names = (await ev3.listFiles()).map(f => f.name); assert.ok(names.includes('BrkProg_SAVE') && names.includes('OpenEV3'));
  eq(await ev3.listFiles('../prjs/OpenEV3/'), [{ name: 'test.rbf', dir: false, size: 2560, md5: '0'.repeat(32) }]);
  eq(Array.from(await ev3.download('OpenEV3/test.rbf')), Array.from(data));
  await ev3.runProgram('OpenEV3/test.rbf'); assert.strictEqual(s.runningProgram, '../prjs/OpenEV3/test.rbf'); assert.strictEqual(await ev3.programRunning(), true);
  await ev3.stopProgram(); assert.strictEqual(s.runningProgram, null);
  await ev3.deleteFile('OpenEV3/test.rbf'); await assert.rejects(() => ev3.deleteFile('OpenEV3/test.rbf'), e => e.name === 'EV3Error');
  await assert.rejects(() => ev3.runProgram('nope.rbf'), e => e.name === 'EV3Error');
  const ev3b = new EV3(new S.SimTransport()); ev3b.timeout = 20; ev3b.t.ev3.handle = async () => null;
  await assert.rejects(() => ev3b.battery(), /no reply/);
});

(async () => {
  let failed = 0;
  for (const t of tests) { try { await t.f(); console.log('ok   ' + t.n); } catch (e) { failed++; console.log('FAIL ' + t.n + '\n     ' + (e.stack || e)); } }
  console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
