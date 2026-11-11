/* OpenEV3 Workbench - UI wiring. */
(function () {
  'use strict';
  const hit = (e, d, ok, dur) => { try { if (window.OMStats) OMStats.hit(e, d, ok, dur); } catch (x) { /* counters never break the app */ } };
  const STAT_EVENTS = [['Reading brick', null, ''], ['Sending program', 'program', 'rbf'], ['Uploading file', 'file', 'upload'], ['Delete', 'file', 'delete'], ['New folder', 'file', 'mkdir'], ['Running', 'run', 'now'], ['Run', 'run', 'uploaded']];
  function stat(label, ok) { for (const [p, e, d] of STAT_EVENTS) if (label.startsWith(p)) { if (e) hit(e, d, ok); return; } hit('control', label.toLowerCase().slice(0, 32), ok); }
  const P = OpenEV3.protocol, T = OpenEV3.transports, S = OpenEV3.sim;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let transport = null, ev3 = null, simT = null, pollTimer = null, msgCount = 0, devices = [], cwd = '../prjs/';
  const store = { get(k, d) { try { const v = localStorage.getItem('openev3.' + k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('openev3.' + k, v); } catch (e) { /* ignore */ } } };

  /* ------------------------------------------------ views, toasts, console */
  const VIEWS = ['connect', 'program', 'control', 'files', 'console'];
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'connect';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.rail button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    store.set('view', name); if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'program' && typeof Blockly !== 'undefined' && bws && editorMode === 'blocks') setTimeout(() => Blockly.svgResize(bws), 0);
  }
  document.querySelectorAll('.rail button[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS.includes(h)) showView(h); });
  document.addEventListener('keydown', e => { if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return; if (e.key >= '1' && e.key <= '5') showView(VIEWS[e.key - 1]); });
  function toast(msg, kind, ms) { const el = document.createElement('div'); el.className = 'toast' + (kind ? ' ' + kind : ''); el.textContent = msg; $('toasts').appendChild(el); setTimeout(() => el.remove(), ms || (kind === 'bad' ? 6000 : 3000)); }
  const con = $('con');
  function conLine(cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; con.appendChild(d); while (con.childElementCount > 1500) con.removeChild(con.firstChild); if ($('conAuto').checked) con.scrollTop = con.scrollHeight; }
  const stamp = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');
  function logMsg(dir, bytes, note) { msgCount++; $('conStats').textContent = msgCount + ' messages' + (ev3 ? ', ' + ev3.stats.errors + ' errors' : ''); conLine(dir, stamp() + ' ' + dir.toUpperCase() + ' ' + P.hex(bytes) + (note ? '   ; ' + note : '')); }
  const logNote = (t, cls) => conLine(cls || 'note', stamp() + ' -- ' + t);
  $('btnConClear').addEventListener('click', () => { con.textContent = ''; });
  $('btnConCopy').addEventListener('click', () => navigator.clipboard.writeText(con.innerText).then(() => toast('Console copied'), () => toast('Copy blocked', 'bad')));
  function setLink(state, text) { $('pillLink').className = 'pill ' + state; if (text) $('linkText').textContent = text; }
  const errorText = e => (e && e.name === 'NotFoundError') ? 'No device chosen.' : ((e && e.message) || String(e));
  async function run(label, fn) {
    if (!ev3) { toast('Connect to the brick first.', 'bad'); showView('connect'); return false; }
    if (ev3.busy) { toast('Busy, wait a moment.'); return false; }
    ev3.busy = true; setLink('busy', label || 'Working…');
    try { await fn(); stat(label, true); return true; } catch (e) { logNote(label + ': ' + errorText(e), 'err'); toast(errorText(e), 'bad'); stat(label, false); return false; }
    finally { ev3.busy = false; setLink('on', transport ? transport.name : ''); }
  }

  /* ------------------------------------------------ connect */
  const linkKind = () => document.querySelector('input[name=link]:checked').value;
  document.querySelectorAll('input[name=link]').forEach(r => r.addEventListener('change', () => store.set('link', linkKind())));
  async function connect() {
    const kind = linkKind();
    try {
      if (kind === 'sim') { simT = new S.SimTransport({ sleeper: s => sleep(Math.min(s * 1000, 2000)) }); transport = simT; simT.ev3.state.inputs[0] = { type: 16, mode: 0, values: [0] }; simT.ev3.state.inputs[2] = { type: 29, mode: 0, values: [50] }; simT.ev3.state.inputs[3] = { type: 30, mode: 0, values: [40] }; simT.ev3.state.motors[3].type = 8; }
      else if (kind === 'usb') transport = new T.HidTransport();
      else transport = new T.BluetoothSerialTransport();
      setLink('busy', 'Opening…'); await transport.open();
    } catch (e) { transport = null; setLink('off', 'Not connected'); if (e && e.name === 'NotFoundError') { toast('No device chosen.'); return; } toast('Could not open the link: ' + errorText(e), 'bad', 9000); hit('connect', kind, false); return; }
    ev3 = new OpenEV3.EV3(transport, { log: logMsg });
    if (kind === 'bt') ev3.timeout = 3000;
    document.body.classList.remove('disconnected'); document.body.classList.toggle('sim', kind === 'sim');
    $('btnRefresh').hidden = false; $('btnDisconnect').hidden = false; $('btnConnect').disabled = true;
    $('infoLink').textContent = transport.name + ' (' + (transport.label || '') + ')';
    logNote('connected over ' + transport.name); setLink('on', transport.name);
    const ok = await run('Reading brick', refreshInfo); hit('connect', kind, ok);
    if (ok) toast('Connected to ' + $('infoName').textContent, 'good');
  }
  async function refreshInfo() {
    const i = await ev3.info();
    $('infoName').textContent = i.name; $('nameText').textContent = i.name; $('fwText').textContent = i.firmware; $('pillName').hidden = false;
    $('infoFw').textContent = i.firmware + ', hardware ' + i.hardware + ', ' + i.os;
    $('infoBatt').textContent = i.batteryV.toFixed(2) + ' V (' + i.batteryPct + '%)'; $('battText').textContent = i.batteryV.toFixed(2) + ' V'; $('pillBatt').hidden = false;
    $('infoVol').textContent = (await ev3.volume()) + '%'; $('volume').value = $('infoVol').textContent.replace('%', '');
    const sl = await ev3.sleepMinutes(); $('infoSleep').textContent = sl ? sl + ' min' : 'never';
    await detectDevices();
    $('infoStats').textContent = ev3.stats.sent + ' sent, ' + ev3.stats.errors + ' errors'; $('newName').placeholder = i.name;
  }
  async function disconnect() {
    stopPolling(); if (transport) { try { await transport.close(); } catch (e) { /* ignore */ } }
    transport = ev3 = simT = null; document.body.classList.add('disconnected'); document.body.classList.remove('sim');
    $('btnRefresh').hidden = true; $('btnDisconnect').hidden = true; $('btnConnect').disabled = false; $('pillName').hidden = true; $('pillBatt').hidden = true;
    ['infoLink', 'infoName', 'infoFw', 'infoBatt', 'infoVol', 'infoSleep', 'infoDevs', 'infoStats'].forEach(id => { $(id).textContent = '-'; });
    setLink('off', 'Not connected'); logNote('disconnected');
  }
  $('btnConnect').addEventListener('click', connect); $('btnDisconnect').addEventListener('click', disconnect);
  $('btnRefresh').addEventListener('click', () => run('Reading brick', refreshInfo));
  $('btnBeep').addEventListener('click', () => run('Beep', () => ev3.playTone(880, 200, 50)));
  $('btnRename').addEventListener('click', () => run('Rename', async () => { const n = $('newName').value.trim(); if (!n) throw new Error('enter a name (up to 13 characters)'); await ev3.setName(n); await refreshInfo(); toast('Brick is now called ' + n, 'good'); }));
  $('btnSelfTest').addEventListener('click', () => run('Self test', async () => {
    await ev3.playTone(523, 150, 50); await ev3.led('orange_pulse'); await ev3.displayText(['OpenEV3 self test', '', 'reading ports…']);
    await detectDevices();
    const notes = [];
    for (const d of devices) { if (!d.present) continue; if (d.no >= 16) { await ev3.motorDegrees(d.port, 30, 20, true, true); await ev3.motorDegrees(d.port, 30, -20, true, true); notes.push(d.port + ': ' + d.typeName); } else { const v = await ev3.sensorValue(d.port); notes.push(d.port + ': ' + d.typeName + ' = ' + v); } }
    await ev3.displayText(['OpenEV3 self test', 'done']); await ev3.led('green'); await ev3.playTone(784, 200, 50);
    toast('Self test done. ' + (notes.join(', ') || 'Nothing is plugged in.'), 'good', 8000);
  }));
  $('simS1').addEventListener('change', e => { if (simT) simT.ev3.state.inputs[0].values = [Number(e.target.value)]; });
  $('simS3').addEventListener('input', e => { $('simS3v').textContent = e.target.value; if (simT) simT.ev3.state.inputs[2].values = [Number(e.target.value)]; });
  $('simS4').addEventListener('input', e => { $('simS4v').textContent = e.target.value; if (simT) simT.ev3.state.inputs[3].values = [Number(e.target.value)]; });

  /* ------------------------------------------------ control: motors */
  function buildMotorCards() {
    const g = $('motorGrid'); g.innerHTML = '';
    for (const m of 'ABCD') {
      const card = document.createElement('div'); card.className = 'panel motor needs-link'; card.dataset.motor = m;
      card.innerHTML = '<div class="row"><span class="name">' + m + '</span><span class="tacho" data-tacho>—</span></div>'
        + '<div class="row tight"><button class="btn icon" data-m="rev" title="Backward">◀</button><button class="btn icon" data-m="fwd" title="Forward">▶</button><span style="flex:1"></span><button class="btn sm stop" data-m="brake">Brake</button><button class="btn sm" data-m="coast">Coast</button></div>'
        + '<label class="f"><span>Speed <span data-pv class="mono">50</span></span><input type="range" min="0" max="100" value="50" data-power></label>'
        + '<div class="row tight"><label class="f"><span>Turn</span><input type="number" data-deg value="360" step="15" style="width:6em"></label><button class="btn sm" data-m="deg" style="align-self:flex-end">° go</button><button class="btn sm" data-m="reset" style="align-self:flex-end">Reset °</button></div>';
      const pw = card.querySelector('[data-power]'); pw.addEventListener('input', () => { card.querySelector('[data-pv]').textContent = pw.value; });
      card.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || !b.dataset.m) return; const sp = Number(pw.value);
        run('Motor ' + m, async () => {
          switch (b.dataset.m) {
            case 'fwd': await ev3.motorSpeed(m, sp); break; case 'rev': await ev3.motorSpeed(m, -sp); break;
            case 'brake': await ev3.motorStop(m, true); break; case 'coast': await ev3.motorStop(m, false); break;
            case 'deg': await ev3.motorDegrees(m, sp, Number(card.querySelector('[data-deg]').value), true, false); break;
            case 'reset': await ev3.motorReset(m); break;
          }
          await sleep(80); await refreshMotor(card);
        });
      });
      g.appendChild(card);
    }
  }
  async function refreshMotor(card) { const st = await ev3.motorState(card.dataset.motor); card.querySelector('[data-tacho]').textContent = st.tacho + ' °' + (st.speed ? ' · ' + st.speed + '%' : ''); }
  $('steer').addEventListener('input', e => { $('steerV').textContent = e.target.value; }); $('drivePower').addEventListener('input', e => { $('drivePv').textContent = e.target.value; });
  const turn = () => Number($('steer').value) * 2;
  $('btnDriveFwd').addEventListener('click', () => run('Drive', () => ev3.drive($('drivePorts').value, Number($('drivePower').value), turn(), 0, 0, true, false)));
  $('btnDriveRev').addEventListener('click', () => run('Drive', () => ev3.drive($('drivePorts').value, -Number($('drivePower').value), turn(), 0, 0, true, false)));
  $('btnDriveStop').addEventListener('click', () => run('Drive', () => ev3.motorStop($('drivePorts').value, true)));
  $('btnAllOff').addEventListener('click', () => run('Motors off', async () => { await ev3.motorStop('ABCD', false); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }));
  $('btnTone').addEventListener('click', () => run('Tone', () => ev3.playTone(Number($('toneHz').value), Number($('toneMs').value), Number($('toneVol').value))));
  $('btnStopSound').addEventListener('click', () => run('Stop sound', () => ev3.stopSound()));
  $('btnPlayFile').addEventListener('click', () => run('Play', () => ev3.playFile($('soundFile').value.trim(), Number($('toneVol').value))));
  $('btnLed').addEventListener('click', () => run('Light', () => ev3.led($('ledSel').value)));
  $('btnVolume').addEventListener('click', () => run('Volume', async () => { await ev3.setVolume(Number($('volume').value)); $('infoVol').textContent = (await ev3.volume()) + '%'; }));
  $('btnDisp').addEventListener('click', () => run('Display', () => ev3.displayText($('dispText').value)));
  $('btnDispClear').addEventListener('click', () => run('Display', () => ev3.displayClear()));
  $('btnButtons').addEventListener('click', () => run('Buttons', async () => { const b = await ev3.buttons(); $('btnOut').textContent = Object.keys(b).filter(k => b[k]).join(', ') || '(none pressed)'; }));

  /* ------------------------------------------------ control: sensors */
  async function detectDevices() {
    devices = await ev3.devices();
    $('infoDevs').textContent = devices.filter(d => d.present).map(d => d.port + ': ' + d.typeName).join(', ') || 'nothing plugged in';
    const g = $('sensorGrid'); g.innerHTML = '';
    for (const d of devices.slice(0, 4)) {
      const card = document.createElement('div'); card.className = 'panel sensor needs-link'; card.dataset.port = d.port;
      const modes = Object.entries(d.modes).map(([k, v]) => '<option value="' + k + '"' + (Number(k) === d.mode ? ' selected' : '') + '>' + v[0] + (v[1] ? ' (' + v[1] + ')' : '') + '</option>').join('');
      card.innerHTML = '<div class="row"><h3 style="margin:0">Port ' + d.port + '</h3><span style="flex:1"></span><div class="lcd" data-lcd><small>' + d.typeName.toUpperCase() + '</small>' + (d.present ? '—' : '·') + '</div></div>'
        + (d.present ? '<div class="row modes"><select data-mode>' + modes + '</select><button class="btn sm" data-read>Read</button></div>' : '<p class="hint">Nothing plugged in. Press Detect devices after connecting a sensor.</p>');
      if (d.present) card.querySelector('[data-read]').addEventListener('click', () => run('Sensor ' + d.port, () => readSensor(card)));
      g.appendChild(card);
    }
  }
  async function readSensor(card) {
    const d = devices.find(x => x.port === card.dataset.port); if (!d || !d.present) return;
    const mode = Number(card.querySelector('[data-mode]').value); const spec = d.modes[mode] || ['?', '', 1];
    const vals = await ev3.sensorRead(d.port, mode, spec[2]);
    let text = vals.map(v => Number.isInteger(v) ? v : v.toFixed(1)).join(' ');
    if (d.type === 29 && mode === 2) text = P.COLOR_NAMES[vals[0]] || vals[0];
    if (d.type === 16) text = vals[0] ? 'pressed' : 'free';
    card.querySelector('[data-lcd]').innerHTML = '<small>' + d.typeName.toUpperCase() + ' · ' + spec[0] + '</small>' + text + (spec[1] && d.type !== 16 ? ' ' + spec[1] : '');
  }
  async function readAll() { for (const c of document.querySelectorAll('.sensor')) await readSensor(c); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } $('pollSensors').checked = false; }
  $('btnDetect').addEventListener('click', () => run('Detecting devices', detectDevices));
  $('pollSensors').addEventListener('change', e => {
    if (!e.target.checked) { stopPolling(); return; }
    if (!ev3) { toast('Connect first.', 'bad'); e.target.checked = false; return; }
    const tick = async () => { if (!ev3 || ev3.busy) return; ev3.busy = true; try { setLink('busy', 'Polling'); await readAll(); } catch (err) { /* ignore */ } finally { ev3.busy = false; setLink('on', transport.name); } };
    tick(); pollTimer = setInterval(tick, Number($('pollInterval').value));
  });
  $('pollInterval').addEventListener('change', () => { if (pollTimer) { stopPolling(); $('pollSensors').click(); } });

  /* ------------------------------------------------ files */
  const kindOf = n => ({ rbf: 'program', rpf: 'program', rsf: 'sound', rgf: 'picture', rtf: 'text', rdf: 'data log', rxf: 'data log', rtxt: 'text' })[(n.split('.').pop() || '').toLowerCase()] || 'file';
  function renderCrumbs() {
    const parts = cwd.replace(/^\.\.\//, '').split('/').filter(Boolean); const el = $('crumbs'); el.innerHTML = '';
    const mk = (label, path) => { const a = document.createElement('a'); a.textContent = label; a.addEventListener('click', () => { cwd = path; run('Listing files', listFiles); }); el.appendChild(a); el.appendChild(document.createTextNode(' / ')); };
    mk('prjs', '../prjs/'); let acc = '../';
    parts.forEach((p, i) => { acc += p + '/'; if (i > 0) mk(p, acc); });
  }
  async function listFiles() {
    renderCrumbs();
    const files = await ev3.listFiles(cwd); const tb = $('fileTable').tBodies[0]; tb.innerHTML = '';
    if (!files.length) tb.innerHTML = '<tr><td colspan="4" class="muted">Empty folder.</td></tr>';
    files.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    for (const f of files) {
      const tr = tb.insertRow(); const nameCell = tr.insertCell();
      if (f.dir) { const a = document.createElement('a'); a.href = '#'; a.textContent = f.name + '/'; a.addEventListener('click', e => { e.preventDefault(); cwd = cwd + f.name + '/'; run('Listing files', listFiles); }); nameCell.appendChild(a); }
      else nameCell.textContent = f.name;
      tr.insertCell().textContent = f.dir ? '' : f.size.toLocaleString(); tr.insertCell().textContent = f.dir ? 'folder' : kindOf(f.name);
      const act = tr.insertCell(); act.className = 'act';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn sm ' + (cls || ''); b.textContent = label; b.addEventListener('click', fn); act.appendChild(b); };
      if (!f.dir && /\.(rbf|rpf)$/i.test(f.name)) mk('Run', 'run', () => run('Run', async () => { await ev3.runProgram(cwd + f.name); toast('Running ' + f.name, 'good'); }));
      if (!f.dir && /\.rsf$/i.test(f.name)) mk('Play', '', () => run('Play', () => ev3.playFile(cwd + f.name.replace(/\.rsf$/i, ''), 50)));
      if (!f.dir) mk('Download', '', () => run('Download', async () => { $('progFile').style.width = '0%'; const data = await ev3.download(cwd + f.name, progressUI('progFile', 'progFileText', f.name)); saveBlob(f.name, data); }));
      mk('Delete', 'danger', () => run('Delete', async () => { await ev3.deleteFile(cwd + f.name); await listFiles(); }));
    }
  }
  function saveBlob(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function progressUI(barId, textId, label) { const t0 = Date.now(); return (done, total) => { const pct = Math.round(100 * done / Math.max(1, total)); $(barId).style.width = pct + '%'; const el = Date.now() - t0, rate = done / Math.max(el, 1) * 1000; $(textId).textContent = label + ' ' + pct + '%  ' + done + '/' + total + ' B' + (done < total ? '  ETA ' + Math.ceil((total - done) / Math.max(rate, 1)) + ' s' : '  done in ' + (el / 1000).toFixed(1) + ' s'); }; }
  $('btnFilesRefresh').addEventListener('click', () => run('Listing files', listFiles));
  $('btnUploadFile').addEventListener('click', () => $('fileAny').click());
  $('fileAny').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; const data = new Uint8Array(await f.arrayBuffer()); $('progFile').style.width = '0%'; await run('Uploading file ' + f.name, async () => { await ev3.upload(cwd + f.name, data, progressUI('progFile', 'progFileText', f.name)); await listFiles(); toast('Uploaded ' + f.name, 'good'); }); });
  $('btnMkdir').addEventListener('click', () => run('New folder', async () => { const n = $('newDir').value.trim(); if (!n) throw new Error('enter a folder name'); await ev3.mkdir(cwd + n); $('newDir').value = ''; await listFiles(); }));

  /* ------------------------------------------------ console raw */
  $('btnRaw').addEventListener('click', () => run('Raw', async () => {
    const bytes = $('rawHex').value.trim().split(/[\s,]+/).filter(Boolean).map(h => parseInt(h, 16));
    if (!bytes.length || bytes.some(Number.isNaN)) throw new Error('enter hex bytecodes');
    const g = await ev3.direct(bytes, Number($('rawGlobals').value), 0, true);
    toast('OK, globals: ' + (g.length ? P.hex(g) : '(none)'), 'good', 6000);
  }));

  /* ------------------------------------------------ program: blocks (needs asm.js + blocks.js) */
  const Bk = OpenEV3.blocks, A = OpenEV3.asm;
  let bws = null, editorMode = 'blocks', built = null;
  function refreshGenerated() { if (!bws || !Bk) return; try { built = Bk.generate(bws); $('genCode').textContent = built.listing; } catch (e) { built = null; $('genCode').textContent = '// ' + e.message; } }
  function saveBlocksState() { if (!bws) return; try { store.set('blocks', JSON.stringify(Blockly.serialization.workspaces.save(bws))); } catch (e) { /* ignore */ } }
  function loadBlocks(json) { if (!bws) return; bws.clear(); Blockly.serialization.workspaces.load(json, bws); refreshGenerated(); saveBlocksState(); }
  function ensureBlockly() {
    if (bws || !Bk) return;
    const dark = (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark';
    bws = Blockly.inject('blocklyDiv', { toolbox: Bk.toolbox, renderer: 'zelos', theme: Bk.themeFor(dark), trashcan: true, zoom: { controls: true, wheel: true, startScale: 0.7, maxScale: 1.5, minScale: 0.4 }, grid: { spacing: 24, length: 3, colour: dark ? '#2e3742' : '#d5dae2', snap: true }, move: { scrollbars: true, drag: true, wheel: false } });
    let saved = null; try { saved = JSON.parse(store.get('blocks', 'null')); } catch (e) { saved = null; }
    try { Blockly.serialization.workspaces.load(saved && saved.blocks ? saved : Bk.starter, bws); } catch (e) { bws.clear(); Blockly.serialization.workspaces.load(Bk.starter, bws); }
    bws.addChangeListener(ev => { if (ev.isUiEvent) return; refreshGenerated(); saveBlocksState(); });
    refreshGenerated();
    Bk.examples.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('blockExampleSel').appendChild(o); });
  }
  function setEditorMode(mode) {
    editorMode = mode;
    document.querySelectorAll('.mode-blocks').forEach(el => { el.hidden = mode !== 'blocks'; });
    document.querySelectorAll('.mode-python').forEach(el => { el.hidden = mode !== 'python'; });
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    store.set('mode', mode);
    if (mode === 'blocks') { ensureBlockly(); setTimeout(() => bws && Blockly.svgResize(bws), 0); }
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { setEditorMode(b.dataset.mode); hit('editor_mode', b.dataset.mode); }));
  window.addEventListener('resize', () => { if (bws && editorMode === 'blocks') Blockly.svgResize(bws); });
  $('blockExampleSel').addEventListener('change', e => { if (e.target.value === '' || !Bk) return; const ex = Bk.examples[e.target.value]; hit('example', ex.name); loadBlocks(ex.json); $('progName').value = 'OpenEV3/' + ex.name.split(/[:(]/)[0].replace(/\s+/g, ''); e.target.value = ''; });
  $('btnBlocksNew').addEventListener('click', () => loadBlocks({ blocks: { languageVersion: 0, blocks: [{ type: 'ev3_program', x: 40, y: 40 }] } }));
  $('btnOpenBlocks').addEventListener('click', () => $('fileBlocks').click());
  $('fileBlocks').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { loadBlocks(JSON.parse(await f.text())); toast('Opened ' + f.name); } catch (err) { toast(f.name + ': not a blocks file', 'bad'); } e.target.value = ''; });
  $('btnSaveBlocks').addEventListener('click', () => bws && saveBlob('program.ev3blocks.json', JSON.stringify(Blockly.serialization.workspaces.save(bws), null, 1), 'application/json'));
  function setOut(lines) { const out = $('buildOut'); out.innerHTML = ''; lines.forEach(([cls, t]) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = t + '\n'; out.appendChild(s); }); }
  function build() { refreshGenerated(); hit('compile', 'blocks', !!built); if (!built) { setOut([['e', $('genCode').textContent]]); return null; } setOut([['ok', 'Built: ' + built.main.length + ' bytes of bytecode, ' + built.globals + ' global bytes, ' + built.threads.length + ' thread' + (built.threads.length === 1 ? '' : 's')]]); return built; }
  function progPath() { let n = $('progName').value.trim().replace(/\.rbf$/i, ''); if (!n.includes('/')) n = 'OpenEV3/' + n; return n; }
  $('btnRunNow').addEventListener('click', async () => {
    const b = build(); if (!b) return;
    if (b.threads.length > 1) { toast('This program has parallel sequences; use Upload, then Run on brick.', 'bad'); return; }
    const size = b.main.length + 7;
    if (size > P.MAX_MESSAGE) { toast('Program is ' + size + ' bytes, too big to run directly (max 1024). Use Upload, then Run uploaded.', 'bad', 7000); return; }
    await run('Running', async () => { $('genDetails').open = false; const g = await ev3.runBytecode(b.direct, b.globals, b.locals); setOut([['ok', 'Ran on the brick as a direct command (' + size + ' bytes).' + (g.length ? ' Globals: ' + P.hex(g.subarray(0, 32)) : '')]]); });
  });
  async function uploadProgram() {
    const b = build(); if (!b) return false;
    const name = progPath() + '.rbf'; $('progUpload').style.width = '0%';
    return run('Sending program ' + name, async () => {
      const dir = name.split('/').slice(0, -1).join('/'); try { await ev3.mkdir(dir); } catch (e) { /* exists */ }
      await ev3.upload(name, b.rbf, progressUI('progUpload', 'progUploadText', name));
      setOut([['ok', 'Uploaded ' + name + ' (' + b.rbf.length + ' bytes). On the brick: File Navigation > ' + dir.replace(/^OpenEV3$/, 'OpenEV3') + ' > ' + name.split('/').pop().replace('.rbf', '')]]);
      toast('Uploaded as ' + name, 'good', 6000);
    });
  }
  $('btnUploadBlocks').addEventListener('click', uploadProgram);
  $('btnRunUploaded').addEventListener('click', () => run('Run', async () => { await ev3.runProgram(progPath() + '.rbf'); toast('Running ' + progPath(), 'good'); }));
  $('btnStopBlocks').addEventListener('click', () => run('Stop', async () => { await ev3.stopProgram(); await ev3.motorStop('ABCD', false); }));

  /* ------------------------------------------------ init */
  function init() {
    buildMotorCards();
    const hidOk = T.HidTransport.available(), serialOk = T.BluetoothSerialTransport.available();
    document.querySelector('input[name=link][value=usb]').disabled = !hidOk; document.querySelector('input[name=link][value=usb]').closest('.choice').classList.toggle('disabled', !hidOk);
    document.querySelector('input[name=link][value=bt]').disabled = !serialOk; document.querySelector('input[name=link][value=bt]').closest('.choice').classList.toggle('disabled', !serialOk);
    if (!hidOk && !serialOk) {
      $('noApi').hidden = false;
      $('noApi').innerHTML = (typeof isSecureContext !== 'undefined' && !isSecureContext) ? 'This page is served over plain <b>http</b>; browsers only hand out USB and serial ports to secure pages. Open the <b>https</b> address, or add this origin to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>. The simulator works either way.' : 'This browser has no WebHID / Web Serial support. Open this page in <b>Chrome</b> or <b>Edge</b>, or use the simulator.';
      document.querySelector('input[name=link][value=sim]').checked = true;
    } else { const saved = store.get('link', 'usb'); const r = document.querySelector('input[name=link][value="' + saved + '"]'); if (r && !r.disabled) r.checked = true; }
    $('progName').value = store.get('progName', 'OpenEV3/Program'); $('progName').addEventListener('input', e => store.set('progName', e.target.value));
    setEditorMode(store.get('mode', 'blocks'));
    const h = location.hash.slice(1); showView(VIEWS.includes(h) ? h : store.get('view', 'connect'));
  }
  init();
})();
