/* Node test runner for the browser-side protocol core.  Run:  node gui/tests/run.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder, Uint8Array, DataView, Map, Set, Promise, Date, Math, Number, String, Object, Array, Error, JSON });
for (const f of ['protocol.js', 'transports.js', 'rcx.js', 'sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx, { filename: f });
}
const { protocol: P, link: L, sim: S } = ctx.OpenRCX;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const hex = s => Uint8Array.from(s.split(' ').map(h => parseInt(h, 16)));

test('packet framing matches Kekoa example', () => {
  assert.deepEqual(Array.from(P.buildPacket([0xF7, 0x12])), Array.from(hex('55 ff 00 f7 08 12 ed 09 f6')));
  assert.deepEqual(Array.from(P.buildPacket([0x10])), Array.from(hex('55 ff 00 10 ef 10 ef')));
});

test('findReply tolerates echo, noise and missing 0x55', () => {
  const cmd = P.buildPacket([0x30]);
  const reply = P.buildPacket([0xCF, 0x1C, 0x22]);
  const buf = Uint8Array.from([1, 2, ...cmd, 0xFF, ...reply, 0xFF]);
  const r = P.findReply(buf, 0x30, 2);
  assert.deepEqual(Array.from(r.payload), [0x1C, 0x22]);
  assert.ok(P.findReply(reply.subarray(1), 0x30, 2));
  assert.ok(P.findReply(P.buildPacket([0xE7]), 0x10, 0), 'toggle bit ignored');
  assert.strictEqual(P.findReply(reply.subarray(0, reply.length - 3), 0x30, 2), null);
  const bad = Uint8Array.from(reply); bad[bad.length - 2] ^= 1; bad[bad.length - 1] ^= 1;
  assert.strictEqual(P.findReply(bad, 0x30, 2), null);
});

test('parseCommand round trip', () => {
  const body = [0x45, 1, 0, 3, 0, 9, 9, 9, 27];
  assert.deepEqual(Array.from(P.parseCommand(P.buildPacket(body))), body);
});

test('S-record parser reproduces documented firmware checksum', () => {
  const img = P.parseSrec(fs.readFileSync(path.join(root, '..', 'firmware', 'firm0309.lgo'), 'utf8'));
  assert.strictEqual(img.start, 0x8000);
  assert.strictEqual(img.checksum, 0xC278);
  const img2 = P.parseSrec(fs.readFileSync(path.join(root, '..', 'firmware', 'firm0328.lgo'), 'utf8'));
  assert.strictEqual(img2.data.length, 24944);
  assert.strictEqual(img2.title, 'firm0328.lgo');
});

test('toggle bit and duplicate rule', async () => {
  const t = new S.SimTransport();
  const link = new L.RcxLink(t);
  await link.send([0x10]); await link.send([0x10]); await link.send([0x10]);
  assert.deepEqual(t.txLog.map(p => P.parseCommand(p)[0]), [0x10, 0x18, 0x10]);
  assert.strictEqual(t.rcx.log.length, 3);
});

test('retries after lost replies, then NoReply', async () => {
  const t = new S.SimTransport({ dropReplies: 2 });
  const link = new L.RcxLink(t); link.timeout = 10;
  const rcx = new L.RCX(link);
  assert.strictEqual(await rcx.batteryMv(), 8700);
  assert.strictEqual(link.stats.retries, 2);
  const blank = new L.RCX(Object.assign(new L.RcxLink(new S.SimTransport({ firmware: false })), { timeout: 10 }));
  await assert.rejects(() => blank.playTone(440, 50), e => e.name === 'NoReply');
});

test('echoing serial tower', async () => {
  const t = new S.SimTransport({ echoes: true, latency: 5 });
  const rcx = new L.RCX(new L.RcxLink(t));
  const v = await rcx.versions();
  assert.strictEqual(v.romText, '3.01');
  assert.strictEqual(v.firmwareText, '3.0208 = firm0328 (RIS 2.0)');
  assert.strictEqual(await rcx.batteryMv(), 8700);
});

test('motors, sensors, values', async () => {
  const t = new S.SimTransport();
  const rcx = new L.RCX(new L.RcxLink(t));
  await rcx.motorPower('AC', 5); await rcx.motorDirection('A', 'rev'); await rcx.motorOn('ABC');
  assert.strictEqual(t.rcx.motors[0] & 0xC8, 0x80);   // on, reverse (fwd bit cleared)
  assert.strictEqual(t.rcx.motors[1] & 0xC8, 0x88);   // on, still forward
  assert.strictEqual(t.rcx.motors[2] & 7, 5);
  await rcx.setSensorType(0, 3); await rcx.setSensorMode(0, 4);
  t.rcx.sensorValues[0] = -17;
  assert.strictEqual(await rcx.sensorValue(0), -17);
  await rcx.setVariable(3, -1234);
  assert.strictEqual(await rcx.variable(3), -1234);
  await rcx.setMessage(42);
  assert.strictEqual(await rcx.message(), 42);
  await rcx.setDatalogSize(10);
  t.rcx.datalog = [{ kind: 0x40, value: 55 }, { kind: 0, value: -3 }];
  assert.deepEqual(await rcx.uploadDatalog(), [{ kind: 0x40, value: 55 }, { kind: 0, value: -3 }]);
  assert.strictEqual((await rcx.memoryMap())[93], 0xFFFF);
});

test('full firmware download into a blank brick', async () => {
  const t = new S.SimTransport({ firmware: false });
  const rcx = new L.RCX(new L.RcxLink(t));
  assert.strictEqual((await rcx.versions()).hasFirmware, false);
  const img = P.parseSrec(fs.readFileSync(path.join(root, '..', 'firmware', 'firm0328.lgo'), 'utf8'));
  let last = 0;
  await rcx.downloadFirmware(img, (d) => { last = d; });
  assert.strictEqual(last, img.data.length);
  assert.strictEqual((await rcx.versions()).hasFirmware, true);
  assert.deepEqual(t.rcx.fwBuf, Array.from(img.data));
  const transfers = t.rcx.log.filter(e => e.op === 0x45);
  assert.strictEqual(transfers.length, Math.ceil(img.data.length / 200));
  assert.strictEqual(transfers[transfers.length - 1].args[0] | (transfers[transfers.length - 1].args[1] << 8), 0);
  await rcx.playTone(440, 20);
});

test('firmware checksum mismatch reported as error 4', async () => {
  const t = new S.SimTransport({ firmware: false });
  const rcx = new L.RCX(new L.RcxLink(t));
  const img = P.parseSrec(fs.readFileSync(path.join(root, '..', 'firmware', 'firm0309.lgo'), 'utf8'));
  const tampered = { start: img.start, checksum: img.checksum, data: Uint8Array.from(img.data) };
  tampered.data[100] ^= 0xFF;
  await assert.rejects(() => rcx.downloadFirmware(tampered), e => e.name === 'ReplyError' && e.code === 4);
});

test('program download with 20-byte chunks', async () => {
  const t = new S.SimTransport();
  const rcx = new L.RCX(new L.RcxLink(t));
  const main = Uint8Array.from({ length: 50 }, (_, i) => i + 1);
  const img = { target: 3, size: 51, variables: {}, chunks: [
    { type: 0, number: 0, data: main, name: 'main' }, { type: 1, number: 1, data: Uint8Array.from([0xF6]), name: 's' }] };
  const seen = [];
  await rcx.downloadProgram(img, 2, (d, tot) => seen.push([d, tot]));
  assert.strictEqual(t.rcx.program, 2);
  assert.deepEqual(Array.from(t.rcx.programs[2]['0:0']), Array.from(main));
  assert.deepEqual(seen[seen.length - 1], [51, 51]);
  const seqs = t.rcx.log.filter(e => e.op === 0x45).map(e => e.args[0] | (e.args[1] << 8));
  assert.deepEqual(seqs, [1, 2, 0, 0]);
  assert.strictEqual(t.rcx.sounds[t.rcx.sounds.length - 1], 5);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + (e.stack || e)); }
  }
  console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
