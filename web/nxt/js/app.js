/* OpenNXT Workbench - UI wiring. */
(function () {
  'use strict';
  const hit = (e, d, ok, dur) => { try { if (window.OMStats) OMStats.hit(e, d, ok, dur); } catch (x) { /* counters never break the app */ } };
  const STAT_EVENTS = [['Reading brick', null, ''], ['Sending program', 'program', 'rxe'], ['Uploading file', 'file', 'upload'], ['Delete', 'file', 'delete'], ['Run', 'run', 'uploaded']];
  function stat(label, ok) { for (const [p, e, d] of STAT_EVENTS) if (label.startsWith(p)) { if (e) hit(e, d, ok); return; } hit('control', label.toLowerCase().slice(0, 32), ok); }
  let compileFrom = 'text';
  const P = OpenNXT.protocol, T = OpenNXT.transports, S = OpenNXT.sim;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let transport = null, nxt = null, simT = null, pollTimer = null, msgCount = 0;
  let compiled = null, files = [];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('opennxt.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('opennxt.' + k, v); } catch (e) { /* ignore */ } },
  };

  /* ---------------------------------------------------------- views, toasts, console */
  const VIEWS = ['connect', 'program', 'control', 'files', 'console'];
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'connect';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.rail button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    store.set('view', name);
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'program' && typeof Blockly !== 'undefined' && bws && editorMode === 'blocks') setTimeout(() => Blockly.svgResize(bws), 0);
  }
  document.querySelectorAll('.rail button[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS.includes(h)) showView(h); });
  document.addEventListener('keydown', e => { if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return; if (e.key >= '1' && e.key <= '5') showView(VIEWS[e.key - 1]); });

  function toast(msg, kind, ms) { const el = document.createElement('div'); el.className = 'toast' + (kind ? ' ' + kind : ''); el.textContent = msg; $('toasts').appendChild(el); setTimeout(() => el.remove(), ms || (kind === 'bad' ? 6000 : 3000)); }
  const con = $('con');
  function conLine(cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; con.appendChild(d); while (con.childElementCount > 1500) con.removeChild(con.firstChild); if ($('conAuto').checked) con.scrollTop = con.scrollHeight; }
  const stamp = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');
  function logMsg(dir, bytes, note) { msgCount++; $('conStats').textContent = msgCount + ' messages' + (nxt ? ', ' + nxt.stats.errors + ' errors' : ''); conLine(dir, stamp() + ' ' + dir.toUpperCase() + ' ' + P.hex(bytes) + (note ? '   ; ' + note : '')); }
  const logNote = (t, cls) => conLine(cls || 'note', stamp() + ' -- ' + t);
  $('btnConClear').addEventListener('click', () => { con.textContent = ''; });
  $('btnConCopy').addEventListener('click', () => navigator.clipboard.writeText(con.innerText).then(() => toast('Console copied'), () => toast('Copy blocked', 'bad')));

  function setLink(state, text) { $('pillLink').className = 'pill ' + state; if (text) $('linkText').textContent = text; }
  function errorText(e) { if (e && e.name === 'NotFoundError') return 'No device chosen.'; return (e && e.message) || String(e); }
  async function run(label, fn) {
    if (!nxt) { toast('Connect to the brick first.', 'bad'); showView('connect'); return false; }
    if (nxt.busy) { toast('Busy, wait a moment.'); return false; }
    nxt.busy = true; setLink('busy', label || 'Working…');
    try { await fn(); stat(label, true); return true; }
    catch (e) { logNote(label + ': ' + errorText(e), 'err'); toast(errorText(e), 'bad'); stat(label, false); return false; }
    finally { nxt.busy = false; setLink('on', transport ? transport.name : ''); }
  }

  /* ---------------------------------------------------------- connect */
  const linkKind = () => document.querySelector('input[name=link]:checked').value;
  document.querySelectorAll('input[name=link]').forEach(r => r.addEventListener('change', () => store.set('link', linkKind())));
  async function connect() {
    const kind = linkKind();
    try {
      if (kind === 'sim') { simT = new S.SimTransport(); transport = simT; }
      else if (kind === 'usb') transport = new T.UsbTransport();
      else transport = new T.BluetoothSerialTransport();
      setLink('busy', 'Opening…');
      await transport.open();
    } catch (e) {
      transport = null; setLink('off', 'Not connected');
      if (e && e.name === 'NotFoundError') { toast('No device chosen.'); return; }
      toast('Could not open the link: ' + errorText(e), 'bad', 9000);
      hit('connect', kind, false);
      return;
    }
    nxt = new OpenNXT.NXT(transport, { log: logMsg });
    if (kind === 'bt') nxt.timeout = 2500;
    document.body.classList.remove('disconnected'); document.body.classList.toggle('sim', kind === 'sim');
    $('btnRefresh').hidden = false; $('btnDisconnect').hidden = false; $('btnConnect').disabled = true;
    $('infoLink').textContent = transport.name + ' (' + (transport.label || '') + ')';
    logNote('connected over ' + transport.name);
    setLink('on', transport.name);
    const ok = await run('Reading brick', refreshInfo); hit('connect', kind, ok);
    if (ok) toast('Connected to ' + $('infoName').textContent, 'good');
  }
  async function refreshInfo() {
    const i = await nxt.deviceInfo();
    const fw = await nxt.firmwareVersion();
    const mv = await nxt.batteryMv();
    const prog = await nxt.currentProgram();
    $('infoName').textContent = i.name; $('nameText').textContent = i.name; $('fwText').textContent = fw.firmware; $('pillName').hidden = false;
    $('infoFw').textContent = fw.firmware + ' (protocol ' + fw.protocol + ')';
    $('infoBatt').textContent = (mv / 1000).toFixed(2) + ' V' + (mv < 6500 ? '  (low)' : ''); $('battText').textContent = (mv / 1000).toFixed(2) + ' V'; $('pillBatt').hidden = false;
    $('infoFlash').textContent = i.freeFlash.toLocaleString() + ' bytes';
    $('infoProg').textContent = prog || '-'; $('infoBt').textContent = i.btAddress;
    $('infoStats').textContent = nxt.stats.sent + ' sent, ' + nxt.stats.errors + ' errors';
    $('newName').placeholder = i.name;
  }
  async function disconnect() {
    stopPolling();
    if (transport) { try { await transport.close(); } catch (e) { /* ignore */ } }
    transport = nxt = simT = null;
    document.body.classList.add('disconnected'); document.body.classList.remove('sim');
    $('btnRefresh').hidden = true; $('btnDisconnect').hidden = true; $('btnConnect').disabled = false; $('pillName').hidden = true; $('pillBatt').hidden = true;
    ['infoLink', 'infoName', 'infoFw', 'infoBatt', 'infoFlash', 'infoProg', 'infoBt', 'infoStats'].forEach(id => { $(id).textContent = '-'; });
    setLink('off', 'Not connected'); logNote('disconnected');
  }
  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('btnRefresh').addEventListener('click', () => run('Reading brick', refreshInfo));
  $('btnBeep').addEventListener('click', () => run('Beep', () => nxt.playTone(880, 200)));
  $('btnRename').addEventListener('click', () => run('Rename', async () => { const n = $('newName').value.trim(); if (!n) throw new Error('enter a name (up to 15 characters)'); await nxt.setBrickName(n); await refreshInfo(); toast('Brick is now called ' + n, 'good'); }));
  $('btnSelfTest').addEventListener('click', () => run('Self test', async () => {
    await nxt.playTone(523, 150); await sleep(200);
    const vals = [];
    for (let p = 1; p <= 4; p++) { const v = await nxt.getInputValues(p); vals.push('port ' + p + ': ' + v.typeName + ' ' + v.scaled); }
    await nxt.motorRun('A', 50, 10); await sleep(300); await nxt.motorRun('A', -50, 10); await sleep(300); await nxt.motorStop('A', false);
    files = await nxt.listFiles(); renderFiles();
    await refreshInfo();
    await nxt.playTone(784, 200);
    toast('Self test done: ' + vals.join(', ') + '; ' + files.length + ' files', 'good', 8000);
  }));
  [1, 2, 3, 4].forEach(n => $('simS' + n).addEventListener('input', e => { $('simS' + n + 'v').textContent = e.target.value; if (!simT) return; if (n === 4) simT.nxt.ultrasonicCm[3] = Number(e.target.value); else simT.nxt.sensors[n - 1].scaled = Number(e.target.value); }));

  /* ---------------------------------------------------------- program: name on the brick */
  // One name, shown in both the Blocks and the NXC text toolbars, remembered, and
  // derived from the example you pick so you always know what you uploaded.
  const nameInputs = Array.from(document.querySelectorAll('[data-progname]'));
  function progName() { return $('progName').value.trim(); }
  function setProgName(name) {
    name = String(name).replace(/\.rxe$/i, '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 15) || 'OpenNXT';
    nameInputs.forEach(i => { i.value = name + '.rxe'; });
    store.set('progName', name + '.rxe');
  }
  nameInputs.forEach(i => i.addEventListener('input', () => { nameInputs.forEach(o => { if (o !== i) o.value = i.value; }); store.set('progName', i.value); }));
  nameInputs.forEach(i => i.addEventListener('change', () => setProgName(i.value)));

  /* ---------------------------------------------------------- program: editor + API */
  const src = $('src'), gutter = $('gutter');
  let errLine = null;
  function renderGutter() { const n = src.value.split('\n').length; let html = ''; for (let i = 1; i <= n; i++) html += (i === errLine ? '<span class="err">' + i + '</span>' : i) + '\n'; gutter.innerHTML = html; gutter.scrollTop = src.scrollTop; }
  src.addEventListener('input', () => { errLine = null; renderGutter(); store.set('src', src.value); if (window.OMAccount) OMAccount.changed(); });
  src.addEventListener('scroll', () => { gutter.scrollTop = src.scrollTop; });
  src.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); src.setRangeText('    ', src.selectionStart, src.selectionEnd, 'end'); src.dispatchEvent(new Event('input')); } });
  OpenNXT.examples.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('exampleSel').appendChild(o); });
  $('exampleSel').addEventListener('change', e => { if (e.target.value === '') return; const ex = OpenNXT.examples[e.target.value]; hit('example', ex.name); if (window.OMAccount) OMAccount.unlink(); src.value = ex.source; src.dispatchEvent(new Event('input')); setProgName(ex.name.split(/[:(]/)[0].replace(/\s+/g, '')); e.target.value = ''; });
  $('btnOpenSrc').addEventListener('click', () => $('fileSrc').click());
  $('fileSrc').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (window.OMAccount) OMAccount.unlink(); src.value = await f.text(); src.dispatchEvent(new Event('input')); setProgName(f.name.replace(/\.[^.]+$/, '')); e.target.value = ''; });
  function saveBlob(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  $('btnSaveSrc').addEventListener('click', () => saveBlob(progName().replace(/\.rxe$/i, '') + '.nxc', src.value, 'text/plain'));
  function insertSnippet(text) {
    const s = src.selectionStart, e = src.selectionEnd; let snippet = text;
    if (text.endsWith('\n')) { const ls = src.value.lastIndexOf('\n', s - 1) + 1; const indent = (/^[ \t]*/.exec(src.value.slice(ls, s)) || [''])[0]; const atStart = src.value.slice(ls, s).trim() === ''; snippet = text.replace(/\n(?=.)/g, '\n' + indent); if (!atStart) snippet = '\n' + indent + snippet; snippet = snippet.replace(/\n$/, '\n' + indent); }
    src.setRangeText(snippet, s, e, 'end');
    const bodyAt = snippet.indexOf('{\n'); if (bodyAt >= 0) { const nl = snippet.indexOf('\n', bodyAt + 2); src.selectionStart = src.selectionEnd = s + (nl >= 0 ? nl : bodyAt + 2); }
    src.dispatchEvent(new Event('input')); src.focus();
  }
  function renderApi(filter) {
    const list = $('apiList'); list.innerHTML = ''; const q = (filter || '').trim().toLowerCase(); let group = null, shown = 0;
    OpenNXT.nxcApi.forEach(item => {
      if (q && !(item.n + ' ' + item.s + ' ' + item.d + ' ' + item.g).toLowerCase().includes(q)) return;
      if (item.g !== group) { group = item.g; const h = document.createElement('h4'); h.textContent = group; list.appendChild(h); }
      const b = document.createElement('button'); b.type = 'button'; b.title = 'Insert at the cursor'; b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = item.s; b.lastChild.textContent = item.d; b.addEventListener('click', () => insertSnippet(item.i)); list.appendChild(b); shown++;
    });
    if (!shown) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'Nothing matches "' + filter + '".'; list.appendChild(d); }
  }
  $('apiSearch').addEventListener('input', e => renderApi(e.target.value));

  /* ---------------------------------------------------------- program: compile (server) */
  const out = $('compileOut');
  function setOut(lines) { out.innerHTML = ''; lines.forEach(([cls, t]) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = t + '\n'; out.appendChild(s); }); }
  function defaultCompileUrl() { return location.protocol === 'file:' ? 'https://openrcx.vp/api/nxc' : '/api/nxc'; }
  function setCompiled(bytes, origin) { compiled = bytes; $('imgSummary').textContent = bytes.length + ' bytes' + (origin ? ' - ' + origin : ''); $('btnUpload').disabled = false; $('btnSaveRxe').disabled = false; }
  async function compile() {
    const url = $('compileUrl').value.trim() || defaultCompileUrl();
    store.set('compileUrl', url);
    errLine = null; $('btnCompile').disabled = true;
    setOut([['', 'Compiling on ' + url + ' …']]);
    try {
      const r = await fetch(url + '?name=' + encodeURIComponent(progName().replace(/\.rxe$/i, '')), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: src.value });
      if (r.status === 200) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        setCompiled(bytes, 'compiled just now');
        hit('compile', compileFrom, true);
        setOut([['ok', 'Compiled: ' + bytes.length + ' bytes']]); renderGutter();
        return true;
      }
      const text = await r.text();
      const lines = text.split('\n').map(l => ['e', l]);
      for (const l of text.split('\n')) { const m = /line (\d+)/.exec(l); if (m) { errLine = Number(m[1]); break; } }
      hit('compile', compileFrom, false);
      lines.push(['e', r.status === 422 ? ('Compilation failed' + (errLine ? ' - first error on line ' + errLine : '') + '.') : ('Compile server answered HTTP ' + r.status)]);
      setOut(lines); renderGutter();
      if (errLine) { const pre = src.value.split('\n').slice(0, errLine - 1).join('\n').length + (errLine > 1 ? 1 : 0); const len = (src.value.split('\n')[errLine - 1] || '').length; src.focus(); src.setSelectionRange(pre, pre + len); }
      return false;
    } catch (e) {
      hit('compile', 'server-unreachable', false);
      setOut([['e', 'Could not reach the compile server at ' + url + ' (' + e.message + ').'], ['', 'The NXC compiler runs on the OpenMindstorms server (TrueNAS). From a local copy of this page, enter https://openrcx.vp/api/nxc above, or compile with BricxCC and use "Open compiled .rxe".']]);
      return false;
    } finally { $('btnCompile').disabled = false; }
  }
  $('btnCompile').addEventListener('click', compile);
  $('btnOpenRxe').addEventListener('click', () => $('fileRxe').click());
  $('fileRxe').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; setCompiled(new Uint8Array(await f.arrayBuffer()), f.name); setProgName(f.name); setOut([['ok', 'Loaded ' + f.name + ': ' + compiled.length + ' bytes']]); e.target.value = ''; });
  $('btnSaveRxe').addEventListener('click', () => compiled && saveBlob(progName(), compiled));
  function progressUI(barId, textId, label) { const t0 = Date.now(); return (done, total) => { const pct = Math.round(100 * done / Math.max(1, total)); $(barId).style.width = pct + '%'; const el = Date.now() - t0, rate = done / Math.max(el, 1) * 1000; $(textId).textContent = label + ' ' + pct + '%  ' + done + '/' + total + ' B' + (done < total ? '  ETA ' + Math.ceil((total - done) / Math.max(rate, 1)) + ' s' : '  done in ' + (el / 1000).toFixed(1) + ' s'); }; }
  async function uploadProgram() {
    if (!compiled) { if (!(await compile())) return false; }
    const name = progName();
    if (!/^[^\\/:*?"<>|]{1,15}\.rxe$/i.test(name)) { toast('Name on brick must be up to 15 characters plus .rxe', 'bad'); return false; }
    $('progUpload').style.width = '0%';
    return run('Sending program ' + name, async () => {
      await nxt.upload(name, compiled, progressUI('progUpload', 'progUploadText', name));
      toast('Uploaded as ' + name + ' (' + compiled.length + ' bytes). Press Run here, or on the brick: My Files > Software files > ' + name.replace(/\.rxe$/i, ''), 'good', 8000);
      try { files = await nxt.listFiles(); renderFiles(); } catch (e) { /* list later */ }
    });
  }
  $('btnUpload').addEventListener('click', uploadProgram);

  /* ---------------------------------------------------------- program: blocks */
  const Bk = OpenNXT.blocks;
  let bws = null, editorMode = 'text';
  const blocksCode = () => bws ? Bk.generate(bws) : '';
  function refreshGenerated() { if (!bws) return; try { $('genCode').textContent = blocksCode(); } catch (e) { $('genCode').textContent = '// ' + e.message; } }
  function saveBlocksState() { if (!bws) return; try { store.set('blocks', JSON.stringify(Blockly.serialization.workspaces.save(bws))); } catch (e) { /* ignore */ } if (window.OMAccount) OMAccount.changed(); }
  function loadBlocks(json) { if (!bws) return; bws.clear(); Blockly.serialization.workspaces.load(json, bws); refreshGenerated(); saveBlocksState(); }
  function ensureBlockly() {
    if (bws || !Bk) return;
    const dark = (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark';
    bws = Blockly.inject('blocklyDiv', { toolbox: Bk.toolbox, renderer: 'zelos', theme: Bk.themeFor(dark), trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.7, maxScale: 1.5, minScale: 0.4 }, grid: { spacing: 24, length: 3, colour: dark ? '#2e3742' : '#d5dae2', snap: true }, move: { scrollbars: true, drag: true, wheel: false } });
    let saved = null; try { saved = JSON.parse(store.get('blocks', 'null')); } catch (e) { saved = null; }
    try { Blockly.serialization.workspaces.load(saved && saved.blocks ? saved : Bk.starter, bws); } catch (e) { bws.clear(); Blockly.serialization.workspaces.load(Bk.starter, bws); }
    bws.addChangeListener(ev => { if (ev.isUiEvent) return; refreshGenerated(); saveBlocksState(); });
    refreshGenerated();
    Bk.examples.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('blockExampleSel').appendChild(o); });
  }
  function setEditorMode(mode) {
    if (mode === 'blocks' && !Bk) { toast('Blockly did not load.', 'bad'); mode = 'text'; }
    editorMode = mode;
    document.querySelectorAll('.mode-blocks').forEach(el => { el.hidden = mode !== 'blocks'; });
    document.querySelectorAll('.mode-text').forEach(el => { el.hidden = mode !== 'text'; });
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    store.set('mode', mode);
    if (mode === 'blocks') { ensureBlockly(); setTimeout(() => bws && Blockly.svgResize(bws), 0); }
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { setEditorMode(b.dataset.mode); hit('editor_mode', b.dataset.mode); }));
  window.addEventListener('resize', () => { if (bws && editorMode === 'blocks') Blockly.svgResize(bws); });
  $('blockExampleSel').addEventListener('change', e => { if (e.target.value === '') return; const ex = Bk.examples[e.target.value]; hit('example', ex.name); if (window.OMAccount) OMAccount.unlink(); loadBlocks(ex.json); setProgName(ex.name.split(/[:(]/)[0].replace(/\s+/g, '')); e.target.value = ''; });
  $('btnBlocksNew').addEventListener('click', () => { if (window.OMAccount) OMAccount.unlink(); loadBlocks({ blocks: { languageVersion: 0, blocks: [{ type: 'nxt_program', x: 40, y: 40 }] } }); });
  $('btnOpenBlocks').addEventListener('click', () => $('fileBlocks').click());
  $('fileBlocks').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { if (window.OMAccount) OMAccount.unlink(); loadBlocks(JSON.parse(await f.text())); toast('Opened ' + f.name); } catch (err) { toast(f.name + ': not a blocks file', 'bad'); } e.target.value = ''; });
  $('btnSaveBlocks').addEventListener('click', () => bws && saveBlob('program.nxtblocks.json', JSON.stringify(Blockly.serialization.workspaces.save(bws), null, 1), 'application/json'));
  $('btnBlocksToText').addEventListener('click', () => { src.value = blocksCode(); src.dispatchEvent(new Event('input')); setEditorMode('text'); toast('Generated NXC copied to the text editor'); });
  async function compileBlocks() { refreshGenerated(); $('genDetails').open = true; const saved = src.value; src.value = blocksCode(); compileFrom = 'blocks'; const ok = await compile(); compileFrom = 'text'; src.value = saved; renderGutter(); return ok; }
  $('btnCompileBlocks').addEventListener('click', compileBlocks);
  $('btnUploadBlocks').addEventListener('click', async () => { if (await compileBlocks()) await uploadProgram(); });
  $('btnRunBlocks').addEventListener('click', () => run('Run', async () => { await nxt.startProgram(progName()); $('infoProg').textContent = progName(); toast('Running ' + progName(), 'good'); }));
  $('btnStopBlocks').addEventListener('click', () => run('Stop', async () => { await nxt.stopProgram(); await nxt.motorsStop(false); }));
  $('btnRun').addEventListener('click', async () => { if (!nxt) { toast('Connect first.', 'bad'); return; } const name = progName(); await run('Run', async () => { await nxt.startProgram(name); $('infoProg').textContent = name; toast('Running ' + name, 'good'); }); });
  $('btnStopProg').addEventListener('click', () => run('Stop', async () => { await nxt.stopProgram(); await nxt.motorsStop(false); $('infoProg').textContent = '-'; }));

  /* ---------------------------------------------------------- control */
  async function refreshMotor(card) { const s = await nxt.getOutputState(card.dataset.motor); card.querySelector('[data-tacho]').textContent = s.rotationCount + ' °' + (s.running ? ' · running' : ''); }
  document.querySelectorAll('.motor').forEach(card => {
    const m = card.dataset.motor;
    const pw = card.querySelector('[data-power]'); pw.addEventListener('input', () => { card.querySelector('[data-pv]').textContent = pw.value; });
    card.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !b.dataset.m) return;
      const power = Number(pw.value);
      run('Motor ' + m, async () => {
        switch (b.dataset.m) {
          case 'fwd': await nxt.motorRun(m, power); break;
          case 'rev': await nxt.motorRun(m, -power); break;
          case 'brake': await nxt.motorStop(m, true); break;
          case 'coast': await nxt.motorStop(m, false); break;
          case 'deg': await nxt.motorRun(m, power * Math.sign(Number(card.querySelector('[data-deg]').value) || 1), Math.abs(Number(card.querySelector('[data-deg]').value))); break;
          case 'reset': await nxt.resetMotorPosition(m, false); break;
        }
        await sleep(60); await refreshMotor(card);
      });
    });
  });
  $('steer').addEventListener('input', e => { $('steerV').textContent = e.target.value; });
  $('drivePower').addEventListener('input', e => { $('drivePv').textContent = e.target.value; });
  $('btnDriveFwd').addEventListener('click', () => run('Drive', () => nxt.motorsSync(Number($('drivePower').value), Number($('steer').value), 0)));
  $('btnDriveRev').addEventListener('click', () => run('Drive', () => nxt.motorsSync(-Number($('drivePower').value), Number($('steer').value), 0)));
  $('btnDriveStop').addEventListener('click', () => run('Drive', async () => { await nxt.motorStop('B', true); await nxt.motorStop('C', true); }));
  $('btnAllOff').addEventListener('click', () => run('Motors off', async () => { await nxt.motorsStop(false); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }));
  $('btnTone').addEventListener('click', () => run('Tone', () => nxt.playTone(Number($('toneHz').value), Number($('toneMs').value))));
  $('btnStopSound').addEventListener('click', () => run('Stop sound', () => nxt.stopSound()));
  $('btnPlayFile').addEventListener('click', () => run('Play', () => { const n = $('soundSel').value; if (!n) throw new Error('list files first, then pick a .rso'); return nxt.playSoundFile(n); }));
  $('btnMsgSend').addEventListener('click', () => run('Message', async () => { await nxt.messageWrite(Number($('msgBox').value) - 1, $('msgText').value); $('msgOut').textContent = 'sent to mailbox ' + $('msgBox').value; }));
  $('btnMsgRead').addEventListener('click', () => run('Message', async () => { const m = await nxt.messageRead(Number($('msgBox').value) - 1); $('msgOut').textContent = m === null ? 'mailbox ' + $('msgBox').value + ' is empty' : 'mailbox ' + $('msgBox').value + ': ' + m; }));

  const sensorKinds = {};
  document.querySelectorAll('.sensor').forEach(card => {
    const port = Number(card.dataset.sensor);
    card.querySelector('[data-apply]').addEventListener('click', () => run('Sensor ' + port, async () => {
      const type = card.querySelector('[data-type]').value;
      sensorKinds[port] = type;
      if (type === 'ultrasonic') await nxt.ultrasonicSetup(port); else await nxt.setInputMode(port, type);
      await sleep(100); await readSensor(card);
    }));
  });
  async function readSensor(card) {
    const port = Number(card.dataset.sensor); const lcd = card.querySelector('[data-lcd]');
    const type = sensorKinds[port] || card.querySelector('[data-type]').value;
    let text;
    if (type === 'ultrasonic') { const cm = await nxt.ultrasonicCm(port); text = cm === null ? '∞' : cm + ' cm'; }
    else {
      const v = await nxt.getInputValues(port);
      text = type === 'color' ? (P.COLOR_NAMES[v.scaled] || v.scaled) : type === 'touch' ? (v.scaled ? 'pressed' : 'free') : type === 'none' ? v.raw : v.scaled;
    }
    lcd.innerHTML = '<small>' + type.toUpperCase().replace('_', ' ') + '</small>' + text;
  }
  async function readAll() { for (const c of document.querySelectorAll('.sensor')) await readSensor(c); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } $('pollSensors').checked = false; }
  $('pollSensors').addEventListener('change', e => {
    if (!e.target.checked) { stopPolling(); return; }
    if (!nxt) { toast('Connect first.', 'bad'); e.target.checked = false; return; }
    const tick = async () => { if (!nxt || nxt.busy) return; nxt.busy = true; try { setLink('busy', 'Polling'); await readAll(); } catch (err) { /* ignore */ } finally { nxt.busy = false; setLink('on', transport.name); } };
    tick(); pollTimer = setInterval(tick, Number($('pollInterval').value));
  });
  $('pollInterval').addEventListener('change', () => { if (pollTimer) { stopPolling(); $('pollSensors').click(); } });
  $('btnReadOnce').addEventListener('click', () => run('Read', readAll));

  /* ---------------------------------------------------------- files */
  const kindOf = n => ({ rxe: 'program', rso: 'sound', ric: 'picture', rpg: 'NXT program', rtm: 'try-me', sys: 'system', txt: 'text', log: 'data log', dat: 'data', csv: 'data' })[(n.split('.').pop() || '').toLowerCase()] || 'file';
  function renderFiles() {
    const tb = $('fileTable').tBodies[0]; tb.innerHTML = '';
    if (!files.length) tb.innerHTML = '<tr><td colspan="4" class="muted">No files on the brick.</td></tr>';
    for (const f of files) {
      const tr = tb.insertRow(); tr.insertCell().textContent = f.name; tr.insertCell().textContent = f.size.toLocaleString(); tr.insertCell().textContent = kindOf(f.name);
      const act = tr.insertCell(); act.className = 'act';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn sm ' + (cls || ''); b.textContent = label; b.addEventListener('click', fn); act.appendChild(b); };
      if (/\.rxe$/i.test(f.name)) mk('Run', 'run', () => run('Run', async () => { await nxt.startProgram(f.name); $('infoProg').textContent = f.name; }));
      if (/\.rso$/i.test(f.name)) mk('Play', '', () => run('Play', () => nxt.playSoundFile(f.name)));
      mk('Download', '', () => run('Download', async () => { $('progFile').style.width = '0%'; const data = await nxt.download(f.name, progressUI('progFile', 'progFileText', f.name)); saveBlob(f.name, data); }));
      mk('Delete', 'danger', () => run('Delete', async () => { await nxt.deleteFile(f.name); files = await nxt.listFiles(); renderFiles(); }));
    }
    const sel = $('soundSel'); sel.innerHTML = '';
    const sounds = files.filter(f => /\.rso$/i.test(f.name));
    if (!sounds.length) sel.innerHTML = '<option value="">(no .rso files)</option>';
    sounds.forEach(f => { const o = document.createElement('option'); o.value = f.name; o.textContent = f.name; sel.appendChild(o); });
    $('filesInfo').textContent = files.length + ' files';
  }
  $('btnFilesRefresh').addEventListener('click', () => run('Listing files', async () => { files = await nxt.listFiles(); renderFiles(); const i = await nxt.deviceInfo(); $('filesInfo').textContent += ', ' + i.freeFlash.toLocaleString() + ' bytes free'; $('infoFlash').textContent = i.freeFlash.toLocaleString() + ' bytes'; }));
  $('btnUploadFile').addEventListener('click', () => $('fileAny').click());
  $('fileAny').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    if (f.name.length > 19) { toast('File names on the brick are at most 15 characters plus extension', 'bad'); return; }
    const data = new Uint8Array(await f.arrayBuffer());
    $('progFile').style.width = '0%';
    await run('Uploading file ' + f.name, async () => { await nxt.upload(f.name, data, progressUI('progFile', 'progFileText', f.name)); files = await nxt.listFiles(); renderFiles(); toast('Uploaded ' + f.name, 'good'); });
  });
  $('wipeConfirm').addEventListener('change', e => { $('btnWipe').disabled = !e.target.checked; });
  $('btnWipe').addEventListener('click', () => run('Deleting all files', async () => { await nxt.deleteUserFlash(); $('wipeConfirm').checked = false; $('btnWipe').disabled = true; files = await nxt.listFiles(); renderFiles(); toast('User flash erased', 'good'); }));

  /* ---------------------------------------------------------- console raw */
  $('btnRaw').addEventListener('click', () => run('Raw', async () => {
    const bytes = $('rawHex').value.trim().split(/[\s,]+/).filter(Boolean).map(h => parseInt(h, 16));
    if (bytes.length < 2 || bytes.some(Number.isNaN)) throw new Error('enter at least type and command, e.g. "00 0b"');
    const r = await nxt.call(bytes[0], bytes[1], bytes.slice(2), Array.from({ length: 256 }, (_, i) => i));
    toast(P.commandName(bytes[1]) + ': status 0x' + r.status.toString(16).padStart(2, '0') + ' (' + (P.STATUS[r.status] || '?') + ')  ' + (r.payload.length ? P.hex(r.payload) : ''), 'good', 6000);
  }));

  /* ---------------------------------------------------------- init */
  function init() {
    const usbOk = T.UsbTransport.available(), serialOk = T.BluetoothSerialTransport.available();
    document.querySelector('input[name=link][value=usb]').disabled = !usbOk; document.querySelector('input[name=link][value=usb]').closest('.choice').classList.toggle('disabled', !usbOk);
    document.querySelector('input[name=link][value=bt]').disabled = !serialOk; document.querySelector('input[name=link][value=bt]').closest('.choice').classList.toggle('disabled', !serialOk);
    if (!usbOk && !serialOk) {
      $('noApi').hidden = false;
      $('noApi').innerHTML = (typeof isSecureContext !== 'undefined' && !isSecureContext)
        ? 'This page is served over plain <b>http</b>, and browsers only hand out USB and serial ports to secure pages. Open the <b>https</b> address instead (trust its certificate once), or add this origin to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>. The simulator works either way.'
        : 'This browser has no WebUSB / Web Serial support. Open this page in <b>Chrome</b> or <b>Edge</b>, or use the simulator.';
      document.querySelector('input[name=link][value=sim]').checked = true;
    } else {
      const saved = store.get('link', 'usb'); const r = document.querySelector('input[name=link][value="' + saved + '"]'); if (r && !r.disabled) r.checked = true;
    }
    src.value = store.get('src', OpenNXT.examples[0].source); renderGutter();
    setProgName(store.get('progName', 'OpenNXT.rxe'));
    $('compileUrl').value = store.get('compileUrl', defaultCompileUrl());
    renderApi('');
    setEditorMode(store.get('mode', 'blocks'));
    const h = location.hash.slice(1); showView(VIEWS.includes(h) ? h : store.get('view', 'connect'));
  }
  init();
  // Optional sign-in + online library (web/shared/account.js); invisible without the service.
  if (window.OMAccount) OMAccount.init({
    app: 'nxt', store, toast,
    get: () => ({ name: progName().replace(/\.rxe$/i, '') || 'Program', mode: editorMode, blocks: bws ? JSON.stringify(Blockly.serialization.workspaces.save(bws)) : store.get('blocks', ''), src: src.value }),
    set: p => {
      setEditorMode(p.mode === 'blocks' ? 'blocks' : 'text');
      if (p.blocks) { try { ensureBlockly(); loadBlocks(JSON.parse(p.blocks)); } catch (e) { /* not a blocks program */ } }
      src.value = p.src || ''; src.dispatchEvent(new Event('input')); setProgName(p.name);
    },
  });
})();
