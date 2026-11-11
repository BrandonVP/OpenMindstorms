/* Node tests for the OpenNXT browser core.  Run:  node web/nxt/tests/run.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder, Uint8Array, DataView, Map, Set, Promise, Date, Math, Number, String, Object, Array, Error, JSON, RegExp });
for (const f of ['protocol.js', 'transports.js', 'nxt.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
const { protocol: P, NXT, sim: S } = ctx.OpenNXT;
const tests = []; const test = (n, f) => tests.push({ n, f });
const eq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

test('framing', () => {
  eq(Array.from(P.build(P.T.DIRECT, P.CMD.PLAY_TONE, [...P.u16(440), ...P.u16(500)])), [0, 3, 0xb8, 1, 0xf4, 1]);
  const r = P.parseReply(Uint8Array.from([2, 0x0b, 0, 0x40, 0x1f])); assert.strictEqual(r.status, 0); assert.strictEqual(P.rdU16(r.payload, 0), 8000);
  eq(Array.from(P.btFrame(Uint8Array.from([0, 0x0b]))), [2, 0, 0, 0x0b]);
  assert.strictEqual(P.cstr(P.name20('prog.rxe')), 'prog.rxe');
  assert.throws(() => P.name20('this-name-is-far-too-long.rxe'));
  assert.strictEqual(P.sensorTypeCode('ultrasonic'), 0x0B);
  assert.strictEqual(P.motorPort('C'), 2);
  assert.strictEqual(P.rdI8(0xCE), -50);
});

test('identity and sound', async () => {
  const t = new S.SimTransport(); const nxt = new NXT(t);
  const i = await nxt.deviceInfo(); assert.strictEqual(i.name, 'NXT'); assert.strictEqual(i.btAddress, '00:16:53:02:C8:E0');
  eq(await nxt.firmwareVersion(), { protocol: '1.124', firmware: '1.31' });
  assert.strictEqual(await nxt.batteryMv(), 8000);
  await nxt.setBrickName('Robbie'); assert.strictEqual((await nxt.deviceInfo()).name, 'Robbie');
  await nxt.playTone(880, 250); await nxt.playSoundFile('Woops.rso');
  eq(t.nxt.sounds, [{ hz: 880, ms: 250 }, 'Woops.rso']);
  await assert.rejects(() => nxt.playSoundFile('nope.rso'), e => e.name === 'NxtError' && e.status === 0xBD);
  await nxt.playTone(440, 100, false); assert.strictEqual(t.txLog[t.txLog.length - 1][0], 0x80); assert.strictEqual(t.queue.length, 0);
});

test('motors', async () => {
  const t = new S.SimTransport(); const nxt = new NXT(t);
  await nxt.motorRun('B', 50, 360);
  const s = await nxt.getOutputState('B'); assert.strictEqual(s.power, 50); assert.strictEqual(s.tachoLimit, 360); assert.strictEqual(s.tachoCount, 360);
  await nxt.motorRun('A', -30); assert.strictEqual((await nxt.getOutputState('A')).tachoCount, -360);
  await nxt.motorsSync(60, 25, 720); const c = await nxt.getOutputState('C'); assert.strictEqual(c.regulation, 2); assert.strictEqual(c.turnRatio, 25);
  await nxt.motorStop('B', false); assert.strictEqual((await nxt.getOutputState('B')).mode, 0);
  await nxt.resetMotorPosition('A'); assert.strictEqual((await nxt.getOutputState('A')).tachoCount, 0);
  await nxt.motorsStop(); assert.strictEqual((await nxt.getOutputState('C')).power, 0);
});

test('sensors, ultrasonic, messages, programs', async () => {
  const t = new S.SimTransport(); const nxt = new NXT(t);
  await nxt.setInputMode(1, 'touch'); const v = await nxt.getInputValues(1); assert.strictEqual(v.typeName, 'touch'); assert.strictEqual(v.modeName, 'bool');
  t.nxt.sensors[0].scaled = 1; assert.strictEqual(await nxt.sensorValue(1), 1);
  await nxt.ultrasonicSetup(4); t.nxt.ultrasonicCm[3] = 23; assert.strictEqual(await nxt.ultrasonicCm(4), 23);
  t.nxt.ultrasonicCm[3] = 255; assert.strictEqual(await nxt.ultrasonicCm(4), null);
  assert.strictEqual(await nxt.messageRead(0), null); await nxt.messageWrite(0, 'hello'); assert.strictEqual(await nxt.messageRead(0), 'hello');
  assert.strictEqual(await nxt.currentProgram(), null); await nxt.startProgram('Untitled-1.rxe'); assert.strictEqual(await nxt.currentProgram(), 'Untitled-1.rxe');
  await nxt.stopProgram(); await nxt.stopProgram(); assert.strictEqual(await nxt.currentProgram(), null);
});

test('files', async () => {
  const t = new S.SimTransport(); const nxt = new NXT(t);
  eq((await nxt.listFiles()).map(f => f.name), ['Untitled-1.rxe', 'Woops.rso']);
  eq(await nxt.listFiles('*.ric'), []);
  const data = new Uint8Array(768); for (let i = 0; i < 768; i++) data[i] = i & 0xFF;
  let last = 0; await nxt.upload('test.rxe', data, p => { last = p; });
  assert.strictEqual(last, 768); eq(Array.from(t.nxt.files['test.rxe']), Array.from(data));
  const opens = t.nxt.log.filter(e => e.cmd === P.CMD.OPEN_WRITE || e.cmd === P.CMD.OPEN_WRITE_LINEAR); assert.strictEqual(opens[opens.length - 1].cmd, P.CMD.OPEN_WRITE_LINEAR);
  eq(Array.from(await nxt.download('test.rxe')), Array.from(data));
  await nxt.upload('log.txt', new TextEncoder().encode('1,2,3'));
  await nxt.deleteFile('test.rxe'); await assert.rejects(() => nxt.deleteFile('test.rxe'), e => e.status === 0x87);
  assert.strictEqual((await nxt.deviceInfo()).freeFlash, 100000 - 5);
});

test('timeouts and unknown commands', async () => {
  const t = new S.SimTransport(); const nxt = new NXT(t); nxt.timeout = 20;
  await assert.rejects(() => nxt.call(P.T.DIRECT, 0x7F), e => e.status === 0xBE);
  t.nxt.handle = () => null;
  await assert.rejects(() => nxt.batteryMv(), /no reply/);
});

(async () => {
  let failed = 0;
  for (const t of tests) { try { await t.f(); console.log('ok   ' + t.n); } catch (e) { failed++; console.log('FAIL ' + t.n + '\n     ' + (e.stack || e)); } }
  console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
